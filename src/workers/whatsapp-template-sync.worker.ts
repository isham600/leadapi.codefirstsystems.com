import { Worker, Job } from "bullmq";
import { db } from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";
import type { WhatsappTemplateSyncJobData } from "../queues/whatsapp-template-sync.queue.js";

const META_GRAPH = "https://graph.facebook.com/v21.0";

// ── helpers (moved from whatsappTemplateSync.controller.ts) ──

function countVars(text: string): number {
  return (text?.match(/\{\{\d+\}\}/g) ?? []).length;
}

function maxVarIndex(text: string): number {
  const matches: string[] = text?.match(/\{\{(\d+)\}\}/g) ?? [];
  return matches.reduce((m: number, s: string) => {
    const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
    return n > m ? n : m;
  }, 0 as number);
}

function parseComponents(components: any[]) {
  let header_type: string | null = null, header_text: string | null = null;
  let header_media_url: string | null = null;
  let header_variable_count = 0, header_character_count = 0;
  let body_message: string | null = null;
  let body_variable_count = 0, body_character_count = 0;
  let footer_text: string | null = null, footer_character_count = 0;
  let button_type: string | null = null;
  let button_count = 0, button_variable_count = 0;
  let is_carousel = 0, is_flow = 0, is_auth = 0;

  for (const c of components ?? []) {
    const type = c.type?.toUpperCase();
    if (type === "HEADER") {
      header_type = c.format ?? null;
      if (c.format === "TEXT") {
        header_text = c.text ?? null;
        header_variable_count  = countVars(c.text ?? "");
        header_character_count = (c.text ?? "").length;
      } else {
        header_media_url = c.example?.header_handle?.[0] ?? null;
      }
    }
    if (type === "BODY") {
      body_message           = c.text ?? null;
      body_variable_count    = countVars(c.text ?? "");
      body_character_count   = (c.text ?? "").length;
    }
    if (type === "FOOTER") {
      footer_text            = c.text ?? null;
      footer_character_count = (c.text ?? "").length;
    }
    if (type === "BUTTONS") {
      const buttons: any[] = c.buttons ?? [];
      button_count          = buttons.length;
      button_type           = buttons[0]?.type ?? null;
      button_variable_count = buttons.reduce((sum: number, b: any) =>
        sum + countVars(b.url ?? "") + countVars(b.text ?? ""), 0);
      if (buttons.some((b: any) => b.type === "FLOW")) is_flow = 1;
    }
    if (type === "CAROUSEL") is_carousel = 1;
  }

  const total_variable_count  = header_variable_count + body_variable_count + button_variable_count;
  const max_variable_index    = maxVarIndex([header_text ?? "", body_message ?? ""].join(" "));
  const total_character_count = header_character_count + body_character_count + footer_character_count;

  return {
    header_type, header_text, header_media_url, header_variable_count, header_character_count,
    body_message, body_variable_count, body_character_count,
    footer_text, footer_character_count,
    button_type, button_count, button_variable_count,
    total_variable_count, max_variable_index, total_character_count,
    is_carousel, is_flow, is_auth,
  };
}

function templateType(tpl: any, parsed: ReturnType<typeof parseComponents>) {
  if (parsed.is_carousel) return "CAROUSEL";
  if (parsed.is_flow)     return "FLOW";
  if (tpl.category === "AUTHENTICATION") return "AUTH";
  return "STANDARD";
}

async function fetchAllTemplates(wabaId: string, accessToken: string): Promise<any[]> {
  const results: any[] = [];
  const baseUrl =
    `${META_GRAPH}/${wabaId}/message_templates` +
    `?fields=id,name,language,category,previous_category,status,` +
    `parameter_format,message_send_ttl_seconds,components` +
    `&limit=200&access_token=${accessToken}`;

  let url: string | null = baseUrl;
  let page = 1;

  while (url) {
    const res     = await fetch(url);
    const rawBody = await res.text();

    console.log(`[templateSync] Meta API page=${page}`, { wabaId, status: res.status, chars: rawBody.length });

    if (!res.ok) { console.error("[templateSync] Meta API error", { wabaId, status: res.status }); break; }

    let json: any;
    try { json = JSON.parse(rawBody); } catch { break; }
    if (json.error) { console.error("[templateSync] Meta error", { wabaId, error: json.error }); break; }

    if (json.data) results.push(...json.data);
    url = json.paging?.next ?? null;
    page++;
  }

  return results;
}

async function upsertTemplate(wabaIdNum: bigint, username: string, tpl: any, parsed: ReturnType<typeof parseComponents>) {
  const now  = new Date();
  const type = templateType(tpl, parsed);
  const row  = {
    waba_id: wabaIdNum, username, meta_template_id: String(tpl.id),
    name: tpl.name, language: tpl.language, category: tpl.category,
    previous_category: tpl.previous_category ?? null, status: tpl.status,
    parameter_format: tpl.parameter_format ?? null, template_type: type,
    is_carousel: parsed.is_carousel, is_flow: parsed.is_flow, is_auth: parsed.is_auth,
    message_send_ttl_seconds: tpl.message_send_ttl_seconds ?? null,
    header_type: parsed.header_type ?? null, header_text: parsed.header_text ?? null,
    header_media_url: parsed.header_media_url ?? null,
    header_variable_count: parsed.header_variable_count, header_character_count: parsed.header_character_count,
    body_message: parsed.body_message ?? null,
    body_variable_count: parsed.body_variable_count, body_character_count: parsed.body_character_count,
    footer_text: parsed.footer_text ?? null, footer_character_count: parsed.footer_character_count,
    button_type: parsed.button_type ?? null, button_count: parsed.button_count,
    button_variable_count: parsed.button_variable_count, total_variable_count: parsed.total_variable_count,
    max_variable_index: parsed.max_variable_index, total_character_count: parsed.total_character_count,
    add_security_recommendation: 0, code_expiration_minutes: null,
    synced_at: now, created_at: now, updated_at: now,
  };
  const { created_at, ...updateFields } = row;
  await (db as any).insertInto("whatsapp_templates").values(row).onDuplicateKeyUpdate(updateFields).execute();
}

// ── worker processor ──────────────────────────────────────────

async function processJob(job: Job<WhatsappTemplateSyncJobData>): Promise<{ synced: number }> {
  const { username, accountId, wabaId, accessToken } = job.data;

  console.log(`[templateSync] processing account ${accountId}`, { wabaId, username });

  const templates = await fetchAllTemplates(wabaId, accessToken);
  console.log(`[templateSync] fetched ${templates.length} templates`, { wabaId });

  const wabaIdNum = BigInt(wabaId);
  let synced = 0;

  for (const tpl of templates) {
    try {
      const parsed = parseComponents(tpl.components ?? []);
      await upsertTemplate(wabaIdNum, username, tpl, parsed);
      synced++;
    } catch (err: any) {
      console.error(`[templateSync] upsert failed for ${tpl.id}: ${err.message}`);
    }
  }

  return { synced };
}

// ── export starter ────────────────────────────────────────────

export function startWhatsappTemplateSyncWorker() {
  const worker = new Worker<WhatsappTemplateSyncJobData>(
    "whatsapp-template-sync",
    processJob,
    { connection: redisConnection as any, concurrency: 3 }
  );

  worker.on("completed", (job, result) => {
    console.log(`[templateSync] job ${job.id} done — synced: ${result.synced}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[templateSync] job ${job?.id} failed: ${err.message}`);
  });

  console.log("[templateSync] worker started — concurrency: 3");
  return worker;
}
