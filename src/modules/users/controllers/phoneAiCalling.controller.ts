import type { FastifyRequest, FastifyReply } from "fastify";
import { randomInt } from "crypto";
import { writeFile, unlink } from "fs/promises";
import { execSync } from "child_process";
import { sql } from "kysely";
import { GoogleAuth } from "google-auth-library";
import { db } from "../../../models/db.js";
import { phoneAiCampaignQueue } from "../../../queues/phone-ai-campaign.queue.js";
import { aiCallLog } from "../../../utils/phone-ai-logger.js";

// ── Shared Google Auth (reuses token) ─────────────────────────
const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

const LANG_CODE: Record<string, string> = {
  hindi: "hi-IN", english: "en-IN", hinglish: "hi-IN",
  marathi: "mr-IN", gujarati: "gu-IN", tamil: "ta-IN", telugu: "te-IN",
};
const VOICE_NAME: Record<string, { male: string; female: string }> = {
  "hi-IN": { female: "hi-IN-Wavenet-A", male: "hi-IN-Wavenet-B" },
  "en-IN": { female: "en-IN-Wavenet-A", male: "en-IN-Wavenet-B" },
  "mr-IN": { female: "mr-IN-Wavenet-A", male: "mr-IN-Wavenet-B" },
  "gu-IN": { female: "gu-IN-Wavenet-A", male: "gu-IN-Wavenet-B" },
  "ta-IN": { female: "ta-IN-Wavenet-A", male: "ta-IN-Wavenet-B" },
  "te-IN": { female: "te-IN-Wavenet-A", male: "te-IN-Wavenet-B" },
};

async function googleTts(text: string, language: string, gender: string, outPath: string) {
  const langCode  = LANG_CODE[language]  ?? "hi-IN";
  const voiceName = VOICE_NAME[langCode]?.[gender as "male"|"female"] ?? "hi-IN-Wavenet-A";
  const client    = await googleAuth.getClient();
  const tokenData = await client.getAccessToken();
  const token     = typeof tokenData === "string" ? tokenData : tokenData?.token;
  if (!token) throw new Error("Failed to obtain Google access token");
  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: langCode, name: voiceName, ssmlGender: gender === "male" ? "MALE" : "FEMALE" },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 8000 },
    }),
  });
  if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  await writeFile(outPath, Buffer.from(json.audioContent, "base64"));
}

async function googleStt(wavPath: string, language: string): Promise<string> {
  const langCode = LANG_CODE[language] ?? "hi-IN";
  const client   = await googleAuth.getClient();
  const tokenData = await client.getAccessToken();
  const token     = typeof tokenData === "string" ? tokenData : tokenData?.token;
  if (!token) throw new Error("Failed to obtain Google access token");
  const audioBytes = (await import("fs")).readFileSync(wavPath).toString("base64");
  const res = await fetch("https://speech.googleapis.com/v1/speech:recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({
      config: { encoding: "LINEAR16", sampleRateHertz: 8000, languageCode: langCode },
      audio:  { content: audioBytes },
    }),
  });
  if (!res.ok) throw new Error(`Google STT ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return json.results?.[0]?.alternatives?.[0]?.transcript ?? "";
}

async function openAiChat(systemPrompt: string, messages: any[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 150,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

function scpToFreePBX(localPath: string, remotePath: string) {
  const host = process.env.FREEPBX_SSH_HOST ?? "";
  const key  = process.env.FREEPBX_SSH_KEY  ?? "/root/.ssh/freepbx_tts";
  const user = process.env.FREEPBX_SSH_USER ?? "root";
  const port = process.env.FREEPBX_SSH_PORT ?? "22";
  if (!host) throw new Error("FREEPBX_SSH_HOST not set");
  execSync(`scp -i ${key} -P ${port} -o StrictHostKeyChecking=no ${localPath} ${user}@${host}:${remotePath}`);
}

// ── helpers ────────────────────────────────────────────────────

async function resolveUsername(req: FastifyRequest): Promise<string | null> {
  const username = req.user?.username;
  if (!username) return null;
  const userType = (req as any).user?.user_type as number | undefined;
  if (userType === 5) {
    const row: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    return row?.parent_username ?? username;
  }
  return username;
}

function generateRequestId(): string {
  return `ai-call-${Date.now()}${randomInt(1000, 9999)}`;
}

// ── AI Credentials ─────────────────────────────────────────────

export const getAiCredentials = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  try {
    const rows: any[] = await (db as any)
      .selectFrom("phone_ai_credentials")
      .selectAll()
      .where("username", "=", username)
      .execute();
    // Mask API keys
    const masked = rows.map((c) => ({
      ...c,
      api_key: c.api_key
        ? `${String(c.api_key).slice(0, 8)}${"*".repeat(Math.max(0, String(c.api_key).length - 8))}`
        : "",
    }));
    return reply.send({ status: 1, data: masked });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to fetch credentials" });
  }
};

export const upsertAiCredentials = async (
  req: FastifyRequest<{ Body: any }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const { provider, api_key, voice_id, model, language } = req.body as any;
  if (!provider || !api_key)
    return reply.status(400).send({ status: 0, message: "provider and api_key are required" });
  try {
    const existing: any = await (db as any)
      .selectFrom("phone_ai_credentials")
      .select(["id"])
      .where("username", "=", username)
      .where("provider", "=", provider)
      .executeTakeFirst();
    if (existing) {
      await (db as any)
        .updateTable("phone_ai_credentials")
        .set({ api_key, voice_id: voice_id ?? null, model: model ?? null, language: language ?? "hi-IN", updated_at: new Date() })
        .where("username", "=", username)
        .where("provider", "=", provider)
        .execute();
    } else {
      await (db as any)
        .insertInto("phone_ai_credentials")
        .values({ username, provider, api_key, voice_id: voice_id ?? null, model: model ?? null, language: language ?? "hi-IN", is_active: 1, created_at: new Date(), updated_at: new Date() })
        .execute();
    }
    return reply.send({ status: 1, message: "Credentials saved successfully" });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to save credentials" });
  }
};

export const deleteAiCredentials = async (
  req: FastifyRequest<{ Params: { provider: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  try {
    await (db as any)
      .deleteFrom("phone_ai_credentials")
      .where("username", "=", username)
      .where("provider", "=", req.params.provider)
      .execute();
    return reply.send({ status: 1, message: "Credentials deleted" });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to delete credentials" });
  }
};

// ── Templates ──────────────────────────────────────────────────

export const listAiTemplates = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  try {
    const rows = await (db as any)
      .selectFrom("phone_ivr_template")
      .selectAll()
      .where("username", "=", username)
      .orderBy("created_at", "desc")
      .execute();
    return reply.send({ status: 1, data: rows });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to fetch templates" });
  }
};

export const createAiTemplate = async (
  req: FastifyRequest<{ Body: any }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const {
    name, description, language, voice_gender, voice_id,
    voice_name, voice_type, language_code, ssml_gender, voice_preview_url,
    greeting, script, fallback_text,
    call_mode, dtmf_options, ai_system_prompt, ai_max_turns,
    max_call_duration, retry_count, retry_interval_min,
  } = req.body as any;
  if (!name || !greeting)
    return reply.status(400).send({ status: 0, message: "name and greeting are required" });
  try {
    const result: any = await (db as any)
      .insertInto("phone_ivr_template")
      .values({
        username, name,
        description:        description       ?? null,
        language:           language          ?? "hindi",
        voice_gender:       voice_gender      ?? "female",
        voice_id:           voice_id          ?? null,
        voice_name:         voice_name        ?? null,
        voice_type:         voice_type        ?? null,
        language_code:      language_code     ?? null,
        ssml_gender:        ssml_gender       ?? null,
        voice_preview_url:  voice_preview_url ?? null,
        call_mode:          call_mode         ?? "voice_blast",
        dtmf_options:       dtmf_options      ? JSON.stringify(dtmf_options) : null,
        ai_system_prompt:   ai_system_prompt  ?? null,
        ai_max_turns:       ai_max_turns      ?? 3,
        greeting,
        script:             script            ?? null,
        fallback_text:      fallback_text     ?? null,
        max_call_duration:  max_call_duration ?? 120,
        retry_count:        retry_count       ?? 1,
        retry_interval_min: retry_interval_min ?? 30,
        is_active: 1,
        created_at: new Date(), updated_at: new Date(),
      })
      .execute();
    return reply.status(201).send({
      status: 1,
      message: "Template created",
      data: { id: Number(result?.insertId ?? result?.[0]?.insertId ?? 0) },
    });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to create template" });
  }
};

export const updateAiTemplate = async (
  req: FastifyRequest<{ Params: { id: string }; Body: any }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const id = parseInt(req.params.id);
  const body = req.body as any;
  // Remove fields that shouldn't be overwritten
  delete body.id;
  delete body.username;
  delete body.created_at;
  try {
    await (db as any)
      .updateTable("phone_ivr_template")
      .set({ ...body, updated_at: new Date() })
      .where("id", "=", id)
      .where("username", "=", username)
      .execute();
    return reply.send({ status: 1, message: "Template updated" });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to update template" });
  }
};

export const deleteAiTemplate = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  try {
    await (db as any)
      .deleteFrom("phone_ivr_template")
      .where("id", "=", parseInt(req.params.id))
      .where("username", "=", username)
      .execute();
    return reply.send({ status: 1, message: "Template deleted" });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to delete template" });
  }
};

// ── Campaigns ──────────────────────────────────────────────────

export const listAiCampaigns = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const page   = parseInt(req.query.page  || "1");
  const limit  = parseInt(req.query.limit || "20");
  const offset = (page - 1) * limit;
  try {
    const totalRow: any = await (db as any)
      .selectFrom("phone_ivr_camp_summury")
      .select((db as any).fn.count("id").as("count"))
      .where("username", "=", username)
      .executeTakeFirst();
    const rows = await (db as any)
      .selectFrom("phone_ivr_camp_summury")
      .selectAll()
      .where("username", "=", username)
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();
    return reply.send({
      status: 1,
      data: rows,
      pagination: { page, limit, total: Number(totalRow?.count ?? 0) },
    });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to fetch campaigns" });
  }
};

export const createAiCampaign = async (
  req: FastifyRequest<{ Body: any }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { name, template_id, numbers, schedule_date, schedule_time } = req.body as any;
  if (!name || !template_id || !numbers?.length)
    return reply.status(400).send({ status: 0, message: "name, template_id, and numbers are required" });

  // Validate template belongs to user
  const template: any = await (db as any)
    .selectFrom("phone_ivr_template")
    .select(["id", "name"])
    .where("id", "=", Number(template_id))
    .where("username", "=", username)
    .executeTakeFirst();
  if (!template)
    return reply.status(404).send({ status: 0, message: "Template not found" });

  // Normalise number list: accepts strings or objects { phone, name?, lead_id? }
  const cleanNumbers: { phone: string; name?: string; lead_id?: number }[] = (numbers as any[])
    .map((n) => {
      if (typeof n === "string") {
        const phone = n.replace(/\D/g, "");
        return { phone };
      }
      const phone = ((n.phone || n.number || n.mobile || "") as string).replace(/\D/g, "");
      return { phone, name: n.name ?? n.lead_name ?? undefined, lead_id: n.lead_id ?? undefined };
    })
    .filter((n) => n.phone.length >= 7);

  if (!cleanNumbers.length)
    return reply.status(400).send({ status: 0, message: "No valid phone numbers provided" });

  const requestId = generateRequestId();
  const now       = new Date();

  try {
    // Insert campaign summary row
    await (db as any)
      .insertInto("phone_ivr_camp_summury")
      .values({
        request_id:    requestId,
        username,
        name,
        template_id:   Number(template_id),
        template_name: template.name,
        total_numbers: cleanNumbers.length,
        pending:       cleanNumbers.length,
        calling: 0, answered: 0, not_answered: 0, failed: 0, completed: 0,
        schedule_date: schedule_date ?? null,
        schedule_time: schedule_time ?? null,
        status: "pending",
        created_at: now, updated_at: now,
      })
      .execute();

    // Batch-insert detail rows (500 per chunk to avoid huge queries)
    const CHUNK = 500;
    for (let i = 0; i < cleanNumbers.length; i += CHUNK) {
      const chunk = cleanNumbers.slice(i, i + CHUNK);
      const rows = chunk.map((n) => ({
        request_id:    requestId,
        username,
        campaign_name: name,
        template_id:   Number(template_id),
        phone_number:  n.phone,
        lead_name:     n.name    ?? null,
        lead_id:       n.lead_id ?? null,
        status:        "pp1",
        retry_count:   0,
        schedule_date: schedule_date ?? null,
        schedule_time: schedule_time ?? null,
        created_at: now, updated_at: now,
      }));
      await (db as any).insertInto("phone_ivr_camp_details").values(rows).execute();
    }

    // If no schedule, enqueue immediately; otherwise the schedule_date acts as a trigger
    // for your cron / scheduler to call PATCH /campaigns/:requestId/status {status:"running"}
    if (!schedule_date) {
      await phoneAiCampaignQueue.add(
        `campaign-${requestId}`,
        { requestId, username },
        { jobId: requestId } // deduplicate: one job per requestId
      );
    }

    return reply.status(201).send({
      status: 1,
      message: "Campaign created successfully",
      data: { request_id: requestId, total: cleanNumbers.length, queued: !schedule_date },
    });
  } catch (e: any) {
    return reply.status(500).send({ status: 0, message: "Failed to create campaign", error: e?.message });
  }
};

export const getAiCampaignDetails = async (
  req: FastifyRequest<{
    Params: { requestId: string };
    Querystring: { page?: string; limit?: string; status?: string };
  }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const { requestId } = req.params;
  const page   = parseInt(req.query.page  || "1");
  const limit  = parseInt(req.query.limit || "50");
  const offset = (page - 1) * limit;
  try {
    const summary: any = await (db as any)
      .selectFrom("phone_ivr_camp_summury")
      .selectAll()
      .where("request_id", "=", requestId)
      .where("username",   "=", username)
      .executeTakeFirst();
    if (!summary)
      return reply.status(404).send({ status: 0, message: "Campaign not found" });

    let q = (db as any)
      .selectFrom("phone_ivr_camp_details")
      .selectAll()
      .where("request_id", "=", requestId);
    if (req.query.status) q = q.where("status", "=", req.query.status);

    const totalRow: any = await (db as any)
      .selectFrom("phone_ivr_camp_details")
      .select((db as any).fn.count("id").as("count"))
      .where("request_id", "=", requestId)
      .executeTakeFirst();

    const details = await q.orderBy("id", "desc").limit(limit).offset(offset).execute();

    return reply.send({
      status: 1,
      data: {
        summary,
        details,
        pagination: { page, limit, total: Number(totalRow?.count ?? 0) },
      },
    });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to fetch campaign details" });
  }
};

export const updateAiCampaignStatus = async (
  req: FastifyRequest<{ Params: { requestId: string }; Body: { status: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const { status } = req.body;
  if (!["running", "paused", "cancelled"].includes(status))
    return reply.status(400).send({ status: 0, message: "Invalid status value" });
  try {
    await (db as any)
      .updateTable("phone_ivr_camp_summury")
      .set({ status, updated_at: new Date() })
      .where("request_id", "=", req.params.requestId)
      .where("username",   "=", username)
      .execute();

    // Re-enqueue when manually set to running (e.g. scheduled campaign started or resumed)
    if (status === "running") {
      await phoneAiCampaignQueue.add(
        `campaign-${req.params.requestId}`,
        { requestId: req.params.requestId, username },
        { jobId: req.params.requestId }
      );
    }

    return reply.send({ status: 1, message: `Campaign ${status}` });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to update campaign status" });
  }
};

export const deleteAiCampaign = async (
  req: FastifyRequest<{ Params: { requestId: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const { requestId } = req.params;
  try {
    await (db as any)
      .deleteFrom("phone_ivr_camp_details")
      .where("request_id", "=", requestId)
      .execute();
    await (db as any)
      .deleteFrom("phone_ivr_camp_summury")
      .where("request_id", "=", requestId)
      .where("username",   "=", username)
      .execute();
    return reply.send({ status: 1, message: "Campaign deleted" });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to delete campaign" });
  }
};

// ── Worker callback: update individual call result (called by external dialer) ─

export const updateCallResult = async (
  req: FastifyRequest<{ Params: { id: string }; Body: any }>,
  reply: FastifyReply,
) => {
  const { id } = req.params;
  const { status, call_duration, call_sid, recording_url, notes, conversation } = req.body as any;
  if (!status) return reply.status(400).send({ status: 0, message: "status is required" });
  try {
    const detail: any = await (db as any)
      .selectFrom("phone_ivr_camp_details")
      .select(["request_id"])
      .where("id", "=", Number(id))
      .executeTakeFirst();
    if (!detail) return reply.status(404).send({ status: 0, message: "Record not found" });

    const updateFields: any = {
      status,
      call_duration:  call_duration  ?? null,
      call_sid:       call_sid       ?? null,
      recording_url:  recording_url  ?? null,
      notes:          notes          ?? null,
      updated_at:     new Date(),
    };
    if (status === "calling")    updateFields.called_at    = new Date();
    if (["answered","not_answered","failed","completed"].includes(status))
      updateFields.completed_at = new Date();

    await (db as any)
      .updateTable("phone_ivr_camp_details")
      .set(updateFields)
      .where("id", "=", Number(id))
      .execute();

    // Recount and refresh summary
    const counts: any = await (db as any)
      .selectFrom("phone_ivr_camp_details")
      .select([
        (db as any).fn.count("id").as("total"),
        sql<number>`SUM(CASE WHEN status = 'pp1'          THEN 1 ELSE 0 END)`.as("pending"),
        sql<number>`SUM(CASE WHEN status = 'calling'      THEN 1 ELSE 0 END)`.as("calling"),
        sql<number>`SUM(CASE WHEN status = 'answered'     THEN 1 ELSE 0 END)`.as("answered"),
        sql<number>`SUM(CASE WHEN status = 'not_answered' THEN 1 ELSE 0 END)`.as("not_answered"),
        sql<number>`SUM(CASE WHEN status = 'failed'       THEN 1 ELSE 0 END)`.as("failed"),
        sql<number>`SUM(CASE WHEN status = 'completed'    THEN 1 ELSE 0 END)`.as("completed"),
      ])
      .where("request_id", "=", detail.request_id)
      .executeTakeFirst();

    const allDone = Number(counts?.pending ?? 0) === 0 && Number(counts?.calling ?? 0) === 0;
    const summarySet: any = {
      pending:      Number(counts?.pending      ?? 0),
      calling:      Number(counts?.calling      ?? 0),
      answered:     Number(counts?.answered     ?? 0),
      not_answered: Number(counts?.not_answered ?? 0),
      failed:       Number(counts?.failed       ?? 0),
      completed:    Number(counts?.completed    ?? 0),
      updated_at:   new Date(),
    };
    if (allDone) summarySet.status = "completed";

    await (db as any)
      .updateTable("phone_ivr_camp_summury")
      .set(summarySet)
      .where("request_id", "=", detail.request_id)
      .execute();

    // Save conversation transcript turns
    if (Array.isArray(conversation) && conversation.length > 0) {
      const turns = conversation.map((msg: any, i: number) => ({
        detail_id:  Number(id),
        request_id: detail.request_id,
        turn:       Math.floor(i / 2) + 1,
        role:       msg.role === 'assistant' ? 'assistant' : 'user',
        message:    String(msg.content ?? ''),
        created_at: new Date(),
      }));
      await (db as any)
        .insertInto("phone_ivr_conversations")
        .values(turns)
        .execute();
    }

    return reply.send({ status: 1, message: "Call result updated" });
  } catch (e: any) {
    return reply.status(500).send({ status: 0, message: "Failed to update", error: e?.message });
  }
};

// ── Recording upload: called by FreePBX AGI after call ends ──────
// POST /phone-ivr/ai/calls/:id/recording  (multipart: recording file)
export const uploadCallRecording = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const { id } = req.params;
  try {
    const parts = req.parts();
    let   fileBuffer: Buffer | null = null;
    let   fileName = `call_${id}.wav`;

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'recording') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
        fileName   = part.filename || fileName;
      }
    }

    if (!fileBuffer || fileBuffer.length < 100)
      return reply.status(400).send({ status: 0, message: "No recording file received" });

    // Save to local recordings dir (or swap for S3/R2 upload)
    const recDir  = process.env.RECORDINGS_DIR ?? "/var/www/html/recordings";
    const recPath = `${recDir}/${fileName}`;
    await writeFile(recPath, fileBuffer);

    // Public URL — adjust base URL to match your static file serving
    const baseUrl  = (process.env.API_BASE_URL ?? "").replace(/\/$/, "");
    const publicUrl = `${baseUrl}/recordings/${fileName}`;

    // Save URL to phone_ivr_camp_details
    await (db as any)
      .updateTable("phone_ivr_camp_details")
      .set({ recording_url: publicUrl, updated_at: new Date() })
      .where("id", "=", Number(id))
      .execute();

    console.log(`[recording] detail=${id} saved ${fileBuffer.length}B → ${publicUrl}`);
    return reply.send({ status: 1, url: publicUrl });
  } catch (e: any) {
    console.error(`[recording] upload error:`, e?.message);
    return reply.status(500).send({ status: 0, message: "Upload failed", error: e?.message });
  }
};

// ── AI Conversation: single turn (called by ai_conv.py AGI) ───
// POST /phone-ivr/ai/conversation/turn
// Body: multipart/form-data { audio: wav file, detail_id, turn, language }
// Returns: { audio_file, response_text, transcript, is_final }

export const conversationTurn = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const parts: Record<string, any> = {};
    let   audioBuf: Buffer | null    = null;

    // Parse multipart
    const mp = req.parts();
    for await (const part of mp) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        audioBuf = Buffer.concat(chunks);
      } else {
        parts[(part as any).fieldname] = (part as any).value;
      }
    }

    const detailId = String(parts.detail_id ?? "0");
    const turn     = Number(parts.turn      ?? 1);
    const language = String(parts.language  ?? "hindi");

    if (!audioBuf || audioBuf.length < 100) {
      return reply.send({ audio_file: "", response_text: "", transcript: "", is_final: true });
    }

    // Load template for this detail to get system_prompt & max_turns
    const detail: any = await (db as any)
      .selectFrom("phone_ivr_camp_details")
      .select(["template_id", "request_id"])
      .where("id", "=", Number(detailId))
      .executeTakeFirst();

    const template: any = detail ? await (db as any)
      .selectFrom("phone_ivr_template")
      .selectAll()
      .where("id", "=", detail.template_id)
      .executeTakeFirst() : null;

    const systemPrompt = template?.ai_system_prompt
      ?? "You are a helpful AI sales agent. Be polite and brief. Respond in the same language the caller speaks.";
    const maxTurns     = Number(template?.ai_max_turns ?? 3);

    // Save audio to /tmp
    const wavPath  = `/tmp/ai_stt_${detailId}_t${turn}.wav`;
    await writeFile(wavPath, audioBuf);

    // ── STT: transcribe caller audio ──────────────────────────
    let transcript = "";
    const sttT0 = Date.now();
    try {
      transcript = await googleStt(wavPath, language);
    } finally {
      unlink(wavPath).catch(() => {});
    }
    aiCallLog(Number(detailId), "stt", {
      turn, transcript, language, audio_bytes: audioBuf.length,
      latency_ms: Date.now() - sttT0,
    });

    if (!transcript.trim()) {
      aiCallLog(Number(detailId), "stt", { turn, note: "empty transcript — skipping turn" });
      return reply.send({ audio_file: "", response_text: "", transcript: "", is_final: turn >= maxTurns });
    }

    // ── LLM: generate response ────────────────────────────────
    const gptT0 = Date.now();
    const responseText = await openAiChat(systemPrompt, [
      { role: "user", content: transcript },
    ]);
    aiCallLog(Number(detailId), "gpt", {
      turn, user: transcript, assistant: responseText, latency_ms: Date.now() - gptT0,
    });

    const isFinal = turn >= maxTurns
      || /bye|goodbye|thank you|shukriya|alvida|theek hai|ok bye/i.test(transcript);

    // ── TTS: synthesize response ──────────────────────────────
    const soundBase   = `ai_resp_${detailId}_t${turn}`;
    const localWav    = `/tmp/${soundBase}.wav`;
    const soundsPath  = process.env.ASTERISK_SOUNDS_PATH ?? "/var/lib/asterisk/sounds";
    const remoteWav   = `${soundsPath}/${soundBase}.wav`;

    const ttsT0 = Date.now();
    await googleTts(responseText, language, template?.voice_gender ?? "female", localWav);
    aiCallLog(Number(detailId), "tts_response", {
      turn, text: responseText, language, sound_base: soundBase,
      latency_ms: Date.now() - ttsT0, is_final: isFinal,
    });

    // SCP to FreePBX
    try {
      scpToFreePBX(localWav, remoteWav);
    } finally {
      unlink(localWav).catch(() => {});
    }

    // Store turn in notes (append)
    const turnNote = `T${turn}|Q:${transcript.slice(0, 80)}|A:${responseText.slice(0, 80)}`;
    await (db as any)
      .updateTable("phone_ivr_camp_details")
      .set({
        notes:      (db as any).raw(`CONCAT(COALESCE(notes,''), ' || ', ${JSON.stringify(turnNote)})`),
        updated_at: new Date(),
      })
      .where("id", "=", Number(detailId))
      .execute();

    return reply.send({
      audio_file:    soundBase,   // AGI will call: STREAM FILE ai_resp_N_tN
      response_text: responseText,
      transcript,
      is_final:      isFinal,
    });

  } catch (e: any) {
    console.error("[conversation/turn]", e.message);
    return reply.send({ audio_file: "", response_text: "", transcript: "", is_final: true });
  }
};

// ── Voicemail detection callback (called by AGI/AMI after answering) ──
// PATCH /phone-ivr/ai/calls/:id/voicemail
export const markVoicemail = async (
  req: FastifyRequest<{ Params: { id: string }; Body: any }>,
  reply: FastifyReply,
) => {
  const { id } = req.params;
  const { notes } = req.body as any;
  try {
    const detail: any = await (db as any)
      .selectFrom("phone_ivr_camp_details")
      .select(["request_id"])
      .where("id", "=", Number(id))
      .executeTakeFirst();
    if (!detail) return reply.status(404).send({ status: 0, message: "Not found" });

    await (db as any)
      .updateTable("phone_ivr_camp_details")
      .set({ status: "not_answered", notes: notes ?? "Voicemail detected", completed_at: new Date(), updated_at: new Date() })
      .where("id", "=", Number(id))
      .execute();

    return reply.send({ status: 1, message: "Marked as voicemail" });
  } catch (e: any) {
    return reply.status(500).send({ status: 0, message: e.message });
  }
};

// ── GET /phone-ivr/ai/calls/:id/logs ─────────────────────────
// Returns all log events for a single call detail row
export const getCallLogs = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const { id } = req.params;
  try {
    const logs = await (db as any)
      .selectFrom("phone_ai_call_logs")
      .select(["id", "event", "turn", "payload", "created_at"])
      .where("detail_id", "=", Number(id))
      .orderBy("created_at", "asc")
      .execute();

    // Parse payload JSON for each row
    return reply.send({
      status: 1,
      logs: logs.map((l: any) => ({
        ...l,
        payload: (() => { try { return JSON.parse(l.payload ?? "{}"); } catch { return {}; } })(),
      })),
    });
  } catch (e: any) {
    return reply.status(500).send({ status: 0, message: e.message });
  }
};
