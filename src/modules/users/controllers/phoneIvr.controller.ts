import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { sql } from "kysely";
import crypto from "crypto";

// ── Helpers ──────────────────────────────────────────────────────────────────

function effectiveUsername(req: FastifyRequest): string {
  const username = req.user?.username ?? "";
  const userType = (req.user as any)?.user_type as number | undefined;
  // agents delegate to parent — resolved per-handler where needed
  return username;
}

async function resolveAccount(username: string, userType?: number) {
  // agent (user_type=5) uses parent account
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

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT (Trunk)
// ─────────────────────────────────────────────────────────────────────────────

export const getPhoneAccount = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const userType = (req.user as any)?.user_type as number | undefined;
  const ownerUsername = await resolveAccount(username, userType);

  const account = await (db as any)
    .selectFrom("phone_ivr_accounts")
    .select([
      "id", "display_name", "provider", "sip_server", "sip_port",
      "websocket_url", "sip_username", "sip_password", "auth_realm", "transport",
      "outbound_proxy", "inbound_enabled", "outbound_enabled",
      "recording_enabled", "transcription_enabled", "browser_calling",
      "caller_id_name", "caller_id_number", "webhook_url",
      "status", "last_registered_at", "error_message", "created_at", "updated_at",
    ])
    .where("username", "=", ownerUsername)
    .executeTakeFirst();

  return reply.send({ status: 1, message: "ok", data: account ?? null });
};

export const upsertPhoneAccount = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const body: any = req.body ?? {};
  const {
    display_name, provider, sip_server, sip_port, websocket_url,
    sip_username, sip_password, auth_realm, transport, outbound_proxy,
    inbound_enabled, outbound_enabled, recording_enabled, transcription_enabled,
    browser_calling, caller_id_name, caller_id_number, webhook_url, webhook_secret,
  } = body;

  if (!sip_server || !sip_username || !sip_password) {
    return reply.status(400).send({ status: 0, message: "sip_server, sip_username, sip_password are required" });
  }

  const existing = await (db as any)
    .selectFrom("phone_ivr_accounts")
    .select(["id"])
    .where("username", "=", username)
    .executeTakeFirst();

  const fields: any = {
    username,
    display_name: display_name || sip_server,
    provider: provider || "Custom",
    sip_server,
    sip_port: sip_port ?? 5060,
    websocket_url: websocket_url || null,
    sip_username,
    sip_password,
    auth_realm: auth_realm || null,
    transport: transport || "WSS",
    outbound_proxy: outbound_proxy || null,
    inbound_enabled: inbound_enabled !== undefined ? Number(inbound_enabled) : 1,
    outbound_enabled: outbound_enabled !== undefined ? Number(outbound_enabled) : 1,
    recording_enabled: recording_enabled !== undefined ? Number(recording_enabled) : 0,
    transcription_enabled: transcription_enabled !== undefined ? Number(transcription_enabled) : 0,
    browser_calling: browser_calling !== undefined ? Number(browser_calling) : 1,
    caller_id_name: caller_id_name || null,
    caller_id_number: caller_id_number || null,
    webhook_url: webhook_url || null,
    webhook_secret: webhook_secret || null,
    status: "active",
    error_message: null,
  };

  if (existing) {
    await (db as any)
      .updateTable("phone_ivr_accounts")
      .set(fields)
      .where("username", "=", username)
      .execute();
    return reply.send({ status: 1, message: "Account updated", data: { id: existing.id } });
  } else {
    const result = await (db as any)
      .insertInto("phone_ivr_accounts")
      .values(fields)
      .executeTakeFirst();
    return reply.status(201).send({ status: 1, message: "Account created", data: { id: Number(result.insertId) } });
  }
};

export const deletePhoneAccount = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .deleteFrom("phone_ivr_accounts")
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "Account disconnected" });
};

// ─────────────────────────────────────────────────────────────────────────────
// DIDs
// ─────────────────────────────────────────────────────────────────────────────

export const getDids = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const rows = await (db as any)
    .selectFrom("phone_ivr_dids")
    .selectAll()
    .where("username", "=", username)
    .orderBy("is_primary", "desc")
    .orderBy("id", "asc")
    .execute();

  return reply.send({ status: 1, data: rows });
};

export const createDid = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const account: any = await (db as any)
    .selectFrom("phone_ivr_accounts")
    .select(["id"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (!account) return reply.status(404).send({ status: 0, message: "No phone account configured" });

  const body: any = req.body ?? {};
  if (!body.number) return reply.status(400).send({ status: 0, message: "number is required" });

  const result = await (db as any)
    .insertInto("phone_ivr_dids")
    .values({
      account_id: account.id,
      username,
      number: body.number,
      friendly_name: body.friendly_name || null,
      route_to: body.route_to || "ivr",
      route_target_id: body.route_target_id || null,
      forward_to: body.forward_to || null,
      is_primary: body.is_primary ? 1 : 0,
      status: "active",
    })
    .executeTakeFirst();

  return reply.status(201).send({ status: 1, message: "DID added", data: { id: Number(result.insertId) } });
};

export const deleteDid = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  const { id } = (req.params as any);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .deleteFrom("phone_ivr_dids")
    .where("id", "=", Number(id))
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "DID removed" });
};

// ─────────────────────────────────────────────────────────────────────────────
// CALLS (CDR) — log + list + stats
// ─────────────────────────────────────────────────────────────────────────────

export const getCalls = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const userType = (req.user as any)?.user_type as number | undefined;
  const ownerUsername = await resolveAccount(username, userType);

  const qs: any = req.query ?? {};
  const page = Math.max(1, parseInt(qs.page ?? "1"));
  const limit = Math.min(100, parseInt(qs.limit ?? "20"));
  const offset = (page - 1) * limit;
  const direction = qs.direction ?? null;
  const status = qs.status ?? null;
  const from = qs.from ?? null;
  const to = qs.to ?? null;

  let q = (db as any)
    .selectFrom("phone_ivr_calls")
    .selectAll()
    .where("username", "=", ownerUsername);

  if (direction) q = q.where("direction", "=", direction);
  if (status) q = q.where("status", "=", status);
  if (from) q = q.where("started_at", ">=", new Date(from));
  if (to) q = q.where("started_at", "<=", new Date(to));

  const [rows, countRow] = await Promise.all([
    q.orderBy("started_at", "desc").limit(limit).offset(offset).execute(),
    (db as any)
      .selectFrom("phone_ivr_calls")
      .select(sql`COUNT(*)`.as("total"))
      .where("username", "=", ownerUsername)
      .executeTakeFirst(),
  ]);

  return reply.send({
    status: 1,
    data: rows,
    pagination: { page, limit, total: Number(countRow?.total ?? 0) },
  });
};

export const logCall = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const account: any = await (db as any)
    .selectFrom("phone_ivr_accounts")
    .select(["id"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (!account) return reply.status(404).send({ status: 0, message: "No phone account" });

  const body: any = req.body ?? {};
  const callUuid = body.call_uuid || crypto.randomUUID();

  const result = await (db as any)
    .insertInto("phone_ivr_calls")
    .values({
      call_uuid: callUuid,
      account_id: account.id,
      username,
      direction: body.direction || "outbound",
      from_number: body.from_number || "",
      to_number: body.to_number || "",
      caller_name: body.caller_name || null,
      agent_username: body.agent_username || null,
      status: body.status || "ringing",
      duration_sec: body.duration_sec ?? null,
      billsec: body.billsec ?? null,
      hangup_cause: body.hangup_cause || null,
      recording_url: body.recording_url || null,
      transcription: body.transcription || null,
      lead_id: body.lead_id || null,
      started_at: body.started_at ? new Date(body.started_at) : new Date(),
      answered_at: body.answered_at ? new Date(body.answered_at) : null,
      ended_at: body.ended_at ? new Date(body.ended_at) : null,
    })
    .executeTakeFirst();

  return reply.status(201).send({ status: 1, message: "Call logged", data: { id: Number(result.insertId), call_uuid: callUuid } });
};

export const updateCall = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  const { uuid } = (req.params as any);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const body: any = req.body ?? {};
  const updateFields: any = {};
  if (body.status)        updateFields.status        = body.status;
  if (body.duration_sec !== undefined) updateFields.duration_sec = body.duration_sec;
  if (body.billsec !== undefined)      updateFields.billsec      = body.billsec;
  if (body.hangup_cause)  updateFields.hangup_cause  = body.hangup_cause;
  if (body.recording_url) updateFields.recording_url = body.recording_url;
  if (body.transcription) updateFields.transcription = body.transcription;
  if (body.answered_at)   updateFields.answered_at   = new Date(body.answered_at);
  if (body.ended_at)      updateFields.ended_at      = new Date(body.ended_at);

  await (db as any)
    .updateTable("phone_ivr_calls")
    .set(updateFields)
    .where("call_uuid", "=", uuid)
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "Call updated" });
};

export const getCallStats = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const userType = (req.user as any)?.user_type as number | undefined;
  const ownerUsername = await resolveAccount(username, userType);

  const qs: any = req.query ?? {};
  const from = qs.from ? new Date(qs.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to   = qs.to   ? new Date(qs.to)   : new Date();

  const [totals, byStatus, byDirection, dailyVolume] = await Promise.all([
    // overall totals
    (db as any)
      .selectFrom("phone_ivr_calls")
      .select([
        sql`COUNT(*)`.as("total_calls"),
        sql`SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END)`.as("answered"),
        sql`SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END)`.as("missed"),
        sql`ROUND(AVG(NULLIF(billsec, 0)), 0)`.as("avg_duration_sec"),
        sql`SUM(billsec)`.as("total_talk_sec"),
      ])
      .where("username", "=", ownerUsername)
      .where("started_at", ">=", from)
      .where("started_at", "<=", to)
      .executeTakeFirst(),

    // by status
    (db as any)
      .selectFrom("phone_ivr_calls")
      .select(["status", sql`COUNT(*)`.as("count")])
      .where("username", "=", ownerUsername)
      .where("started_at", ">=", from)
      .where("started_at", "<=", to)
      .groupBy("status")
      .execute(),

    // by direction
    (db as any)
      .selectFrom("phone_ivr_calls")
      .select(["direction", sql`COUNT(*)`.as("count")])
      .where("username", "=", ownerUsername)
      .where("started_at", ">=", from)
      .where("started_at", "<=", to)
      .groupBy("direction")
      .execute(),

    // daily volume (last 30 days)
    (db as any)
      .selectFrom("phone_ivr_calls")
      .select([sql`DATE(started_at)`.as("date"), sql`COUNT(*)`.as("calls")])
      .where("username", "=", ownerUsername)
      .where("started_at", ">=", from)
      .where("started_at", "<=", to)
      .groupBy(sql`DATE(started_at)`)
      .orderBy(sql`DATE(started_at)`, "asc")
      .execute(),
  ]);

  return reply.send({
    status: 1,
    data: {
      totals,
      by_status: byStatus,
      by_direction: byDirection,
      daily_volume: dailyVolume,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// QUEUES
// ─────────────────────────────────────────────────────────────────────────────

export const getQueues = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const queues = await (db as any)
    .selectFrom("phone_ivr_queues")
    .selectAll()
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, data: queues });
};

export const createQueue = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const account: any = await (db as any)
    .selectFrom("phone_ivr_accounts")
    .select(["id"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (!account) return reply.status(404).send({ status: 0, message: "No phone account configured" });

  const body: any = req.body ?? {};
  if (!body.name) return reply.status(400).send({ status: 0, message: "name is required" });

  const result = await (db as any)
    .insertInto("phone_ivr_queues")
    .values({
      account_id: account.id,
      username,
      name: body.name,
      strategy: body.strategy || "ring-all",
      timeout_sec: body.timeout_sec ?? 30,
      max_wait_sec: body.max_wait_sec ?? 300,
      announce_position: body.announce_position ? 1 : 0,
      overflow_action: body.overflow_action || "voicemail",
      overflow_target: body.overflow_target || null,
      status: "active",
    })
    .executeTakeFirst();

  return reply.status(201).send({ status: 1, message: "Queue created", data: { id: Number(result.insertId) } });
};

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSIONS
// ─────────────────────────────────────────────────────────────────────────────

export const getExtensions = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const rows = await (db as any)
    .selectFrom("phone_ivr_extensions")
    .select([
      "id", "extension", "caller_id_name", "caller_id_number",
      "agent_username", "voicemail_enabled", "do_not_disturb",
      "call_forward_to", "status", "registered_at",
    ])
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, data: rows });
};

export const createExtension = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const account: any = await (db as any)
    .selectFrom("phone_ivr_accounts")
    .select(["id"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (!account) return reply.status(404).send({ status: 0, message: "No phone account configured" });

  const body: any = req.body ?? {};
  if (!body.extension) return reply.status(400).send({ status: 0, message: "extension number is required" });

  const result = await (db as any)
    .insertInto("phone_ivr_extensions")
    .values({
      account_id: account.id,
      username,
      agent_username: body.agent_username || null,
      extension: body.extension,
      sip_password: body.sip_password || crypto.randomBytes(8).toString("hex"),
      caller_id_name: body.caller_id_name || null,
      caller_id_number: body.caller_id_number || null,
      voicemail_enabled: body.voicemail_enabled !== undefined ? Number(body.voicemail_enabled) : 1,
      status: "active",
    })
    .executeTakeFirst();

  return reply.status(201).send({ status: 1, message: "Extension created", data: { id: Number(result.insertId) } });
};

// ─────────────────────────────────────────────────────────────────────────────
// IVR MENUS
// ─────────────────────────────────────────────────────────────────────────────

export const getIvrMenus = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const menus = await (db as any)
    .selectFrom("phone_ivr_menus")
    .selectAll()
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, data: menus });
};

export const createIvrMenu = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const account: any = await (db as any)
    .selectFrom("phone_ivr_accounts")
    .select(["id"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (!account) return reply.status(404).send({ status: 0, message: "No phone account configured" });

  const body: any = req.body ?? {};
  if (!body.name) return reply.status(400).send({ status: 0, message: "name is required" });

  const result = await (db as any)
    .insertInto("phone_ivr_menus")
    .values({
      account_id: account.id,
      username,
      name: body.name,
      greeting_type: body.greeting_type || "tts",
      greeting_text: body.greeting_text || "Welcome. Please press a key to continue.",
      greeting_audio: body.greeting_audio || null,
      voice: body.voice || "en-US-Standard-A",
      timeout_sec: body.timeout_sec ?? 10,
      max_retries: body.max_retries ?? 3,
      timeout_action: body.timeout_action || "repeat",
      invalid_action: body.invalid_action || "repeat",
      is_default: body.is_default ? 1 : 0,
      status: "active",
    })
    .executeTakeFirst();

  return reply.status(201).send({ status: 1, message: "IVR menu created", data: { id: Number(result.insertId) } });
};

// ─────────────────────────────────────────────────────────────────────────────
// VOICEMAILS
// ─────────────────────────────────────────────────────────────────────────────

export const getVoicemails = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const userType = (req.user as any)?.user_type as number | undefined;
  const ownerUsername = await resolveAccount(username, userType);

  const rows = await (db as any)
    .selectFrom("phone_ivr_voicemails")
    .selectAll()
    .where("username", "=", ownerUsername)
    .orderBy("created_at", "desc")
    .limit(50)
    .execute();

  return reply.send({ status: 1, data: rows });
};

export const markVoicemailRead = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  const { id } = (req.params as any);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .updateTable("phone_ivr_voicemails")
    .set({ is_read: 1 })
    .where("id", "=", Number(id))
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "Marked as read" });
};

// ─────────────────────────────────────────────────────────────────────────────
// CALLS BY LEAD
// ─────────────────────────────────────────────────────────────────────────────

export const getCallsByLead = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  const { leadId } = (req.params as any);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const userType = (req.user as any)?.user_type as number | undefined;
  const ownerUsername = await resolveAccount(username, userType);

  // Get lead's phone number for fallback matching
  const lead: any = await (db as any)
    .selectFrom("leads")
    .select(["phone"])
    .where("id", "=", Number(leadId))
    .where("username", "=", ownerUsername)
    .executeTakeFirst();

  // Normalize: strip leading + so it matches how numbers are stored in call logs
  const phone = lead?.phone ? String(lead.phone).replace(/^\+/, "").trim() : null;

  // Fetch calls matched by lead_id OR by phone number in from/to
  const calls: any[] = await (db as any)
    .selectFrom("phone_ivr_calls")
    .selectAll()
    .where("username", "=", ownerUsername)
    .where((eb: any) => {
      const conditions: any[] = [eb("lead_id", "=", Number(leadId))];
      if (phone) {
        conditions.push(eb("from_number", "like", `%${phone}`));
        conditions.push(eb("to_number", "like", `%${phone}`));
      }
      return eb.or(conditions);
    })
    .orderBy("started_at", "desc")
    .limit(100)
    .execute();

  // Compute stats
  const inbound  = calls.filter((c) => c.direction === "inbound").length;
  const outbound = calls.filter((c) => c.direction === "outbound").length;
  const answered = calls.filter((c) => c.status === "answered").length;
  const missed   = calls.filter((c) => c.status === "missed").length;
  const voicemail = calls.filter((c) => c.status === "voicemail").length;

  const answeredCalls = calls.filter((c) => c.status === "answered" && (c.billsec || c.duration_sec));
  const totalSec = calls.reduce((s: number, c: any) => s + (Number(c.billsec) || Number(c.duration_sec) || 0), 0);
  const avgSec   = answeredCalls.length > 0
    ? Math.round(answeredCalls.reduce((s: number, c: any) => s + (Number(c.billsec) || Number(c.duration_sec) || 0), 0) / answeredCalls.length)
    : 0;

  return reply.send({
    status: 1,
    data: {
      calls,
      lead_phone: phone ?? null,
      stats: {
        total: calls.length,
        inbound,
        outbound,
        answered,
        missed,
        voicemail,
        total_sec: totalSec,
        avg_sec: avgSec,
      },
    },
  });
};
