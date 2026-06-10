import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { whatsappTemplateSubmitQueue } from "../../../queues/whatsapp-template-submit.queue.js";

export const createWhatsappTemplate = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });
  }

  // Agent hierarchy
  const userType = (req as any).user?.user_type as number | undefined;
  let accountUsername = username;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    accountUsername = parentRow?.parent_username ?? username;
  }

  // Validate active account exists
  const account: any = await (db as any)
    .selectFrom("whatsapp_accounts")
    .select(["waba_id"])
    .where("username", "=", accountUsername)
    .where("status",   "=", "active")
    .executeTakeFirst();

  if (!account) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "No active WhatsApp account found" });
  }

  const body = req.body as any;

  if (!body?.name || !body?.language || !body?.category || !Array.isArray(body?.components)) {
    return reply.status(400).send({
      status: 0, statuscode: 400,
      message: "name, language, category, and components are required",
    });
  }

  // Parse components to extract header/body/footer text for DB columns
  let header_type: string | null = null;
  let header_text: string | null = null;
  let body_message: string | null = null;
  let footer_text: string | null = null;
  let button_type: string | null = null;
  let button_count = 0;

  for (const c of body.components) {
    const type = (c.type ?? "").toUpperCase();
    if (type === "HEADER") { header_type = c.format ?? null; header_text = c.text ?? null; }
    if (type === "BODY")   { body_message = c.text ?? null; }
    if (type === "FOOTER") { footer_text  = c.text ?? null; }
    if (type === "BUTTONS") {
      const btns = c.buttons ?? [];
      button_count = btns.length;
      button_type  = btns[0]?.type ?? null;
    }
  }

  const now = new Date();

  // Save to DB with status PENDING_SUBMIT
  const result: any = await (db as any)
    .insertInto("whatsapp_templates")
    .values({
      username:        accountUsername,
      waba_id:         account.waba_id,
      meta_template_id: null,
      name:            body.name,
      language:        body.language,
      category:        body.category.toUpperCase(),
      status:          "PENDING",
      template_type:   body.category.toUpperCase() === "AUTHENTICATION" ? "AUTH" : "STANDARD",
      header_type,
      header_text,
      body_message,
      footer_text,
      button_type,
      button_count,
      total_variable_count: 0,
      raw_components:  JSON.stringify(body.components),
      meta_error:      null,
      synced_at:       now,
      created_at:      now,
      updated_at:      now,
    })
    .execute();

  const templateId = Number(result.insertId);

  // Enqueue worker job
  await whatsappTemplateSubmitQueue.add(
    `submit-template-${accountUsername}-${templateId}`,
    { templateId, username: accountUsername },
    { priority: 1 },
  );

  return reply.status(202).send({
    status:     1,
    statuscode: 202,
    message:    "Template saved and queued for submission to Meta. Check status after a few seconds.",
    data: { id: templateId, name: body.name, status: "PENDING" },
  });
};
