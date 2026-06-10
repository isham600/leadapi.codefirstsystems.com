import { Worker, Job } from "bullmq";
import axios from "axios";
import { db } from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";
import type { WhatsappTemplateSubmitJobData } from "../queues/whatsapp-template-submit.queue.js";

const META_GRAPH = "https://graph.facebook.com/v21.0";

async function processJob(job: Job<WhatsappTemplateSubmitJobData>): Promise<void> {
  const { templateId, username } = job.data;

  // Load the template row
  const tpl: any = await (db as any)
    .selectFrom("whatsapp_templates")
    .selectAll()
    .where("id", "=", templateId)
    .executeTakeFirst();

  if (!tpl) {
    throw new Error(`Template ${templateId} not found`);
  }

  // Load active WhatsApp account for this user
  const account: any = await (db as any)
    .selectFrom("whatsapp_accounts")
    .select(["waba_id", "access_token"])
    .where("username", "=", username)
    .where("status",   "=", "active")
    .executeTakeFirst();

  if (!account) {
    await (db as any)
      .updateTable("whatsapp_templates")
      .set({ status: "REJECTED", meta_error: "No active WhatsApp account found", updated_at: new Date() })
      .where("id", "=", templateId)
      .execute();
    return;
  }

  // Build components from saved fields
  const components: any[] = [];

  if (tpl.header_type) {
    const header: any = { type: "HEADER", format: tpl.header_type };
    if (tpl.header_type === "TEXT" && tpl.header_text) header.text = tpl.header_text;
    components.push(header);
  }

  if (tpl.body_message) {
    components.push({ type: "BODY", text: tpl.body_message });
  }

  if (tpl.footer_text) {
    components.push({ type: "FOOTER", text: tpl.footer_text });
  }

  // Use raw_components if stored, otherwise use reconstructed
  const finalComponents = tpl.raw_components
    ? JSON.parse(tpl.raw_components)
    : components;

  try {
    const res = await axios.post(
      `${META_GRAPH}/${account.waba_id}/message_templates`,
      {
        name:       tpl.name,
        language:   tpl.language,
        category:   tpl.category,
        components: finalComponents,
      },
      {
        headers: {
          Authorization: `Bearer ${account.access_token}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    const metaId  = (res.data as any)?.id   ?? null;
    const newStatus = (res.data as any)?.status ?? "PENDING";

    await (db as any)
      .updateTable("whatsapp_templates")
      .set({
        meta_template_id: metaId,
        status:           newStatus,
        meta_error:       null,
        meta_response:    JSON.stringify(res.data),
        updated_at:       new Date(),
      })
      .where("id", "=", templateId)
      .execute();

    console.log(`[template-submit] template ${templateId} submitted → Meta ID ${metaId}, status ${newStatus}`);
  } catch (err: any) {
    const metaMsg = err?.response?.data?.error?.message ?? err?.message ?? "Unknown error";
    const metaCode = err?.response?.data?.error?.code ?? null;
    const errStr = metaCode ? `[${metaCode}] ${metaMsg}` : metaMsg;

    await (db as any)
      .updateTable("whatsapp_templates")
      .set({
        status:        "REJECTED",
        meta_error:    errStr.slice(0, 1000),
        meta_response: err?.response?.data ? JSON.stringify(err.response.data) : null,
        updated_at:    new Date(),
      })
      .where("id", "=", templateId)
      .execute();

    console.error(`[template-submit] template ${templateId} FAILED:`, errStr);
    throw new Error(errStr); // triggers BullMQ retry
  }
}

export function startTemplateSubmitWorker() {
  const worker = new Worker<WhatsappTemplateSubmitJobData>(
    "whatsapp-template-submit",
    processJob,
    {
      connection:  redisConnection as any,
      concurrency: 3,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[template-submit] job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[template-submit] job ${job?.id} failed:`, err.message);
  });

  console.log("[template-submit-worker] started");
  return worker;
}
