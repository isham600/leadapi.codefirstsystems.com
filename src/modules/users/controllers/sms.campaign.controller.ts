import type { FastifyRequest, FastifyReply } from "fastify";
import { randomInt }  from "crypto";
import { db }         from "../../../models/db.js";
import { smsCampaignInsertQueue } from "../../../queues/sms-campaign.queue.js";
import type { SmsCampaignRow, SmsCampaignJobData } from "../../../workers/sms-campaign.worker.js";

// ── constants ──────────────────────────────────────────────────
const CHUNK_SIZE = 500;

// ── helpers ────────────────────────────────────────────────────

function generateRequestId(): string {
  return `lead-sms-${Date.now()}${randomInt(1000, 9999)}`;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function parseNumbers(raw: string): string[] {
  return raw
    .split(/[\r\n,]+/)
    .map(n => n.replace(/\D/g, ""))
    .filter(n => n.length >= 7);
}

// ── POST /sms/campaign/submit ──────────────────────────────────
export const submitSmsCampaign = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = (req as any).user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  // Agent hierarchy — if user_type === 5 (sub-agent), use parent account
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

  const body = req.body as Record<string, any>;

  // ── Validate required fields ────────────────────────────────
  const broadcastName = String(body.broadcast_name ?? "").trim();
  const senderId      = String(body.sender_id      ?? "").trim();
  const msg           = String(body.msg            ?? "").trim();
  const msgRoutes     = String(body.msg_routes     ?? "").trim();
  const msgMode       = String(body.msg_mode       ?? "transactional").trim();
  const contactsRaw   = String(body.contacts       ?? "").trim();

  if (!broadcastName) return reply.status(400).send({ status: 0, statuscode: 400, message: "broadcast_name is required", data: null });
  if (!senderId)      return reply.status(400).send({ status: 0, statuscode: 400, message: "sender_id is required", data: null });
  if (!msg)           return reply.status(400).send({ status: 0, statuscode: 400, message: "msg is required", data: null });
  if (!msgRoutes)     return reply.status(400).send({ status: 0, statuscode: 400, message: "msg_routes is required", data: null });
  if (!contactsRaw)   return reply.status(400).send({ status: 0, statuscode: 400, message: "contacts is required", data: null });

  const templateId  = body.template_id  ? String(body.template_id).trim()  : null;
  const peid        = body.peid         ? String(body.peid).trim()         : null;
  const unicode     = body.unicode === 1 || body.unicode === "1" ? 1 : 0;
  const flash       = body.flash   === 1 || body.flash   === "1" ? 1 : 0;

  const now           = new Date();
  const scheduleDate  = String(body.scheduled_date ?? "").trim() || now.toISOString().slice(0, 10);
  const scheduleTime  = String(body.scheduled_time ?? "").trim() ||
    now.toTimeString().slice(0, 8); // HH:MM:SS

  // ── Parse contacts ──────────────────────────────────────────
  const numbers = parseNumbers(contactsRaw);

  if (numbers.length === 0) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "No valid phone numbers found", data: null });
  }

  // ── Generate request ID ─────────────────────────────────────
  const requestId = generateRequestId();

  // ── Insert summary row ──────────────────────────────────────
  await (db as any)
    .insertInto("smpp_campaign_summery")
    .values({
      username:       accountUsername,
      request_id:     requestId,
      broadcast_name: broadcastName,
      msg,
      msg_mode:       msgMode,
      msg_routes:     msgRoutes,
      sender_id:      senderId,
      template_id:    templateId,
      peid,
      flash,
      unicode,
      contacts:       numbers.length,
      status:         "pending",
      schedule_date:  scheduleDate,
      schedule_time:  scheduleTime,
      created_at:     now,
      updated_at:     now,
    })
    .execute();

  // ── Insert job tracking row ─────────────────────────────────
  const chunks      = chunkArray(numbers.map(r => ({ receiver: r } as SmsCampaignRow)), CHUNK_SIZE);
  const totalChunks = chunks.length;

  await (db as any)
    .insertInto("smpp_insert_job")
    .values({
      request_id:   requestId,
      username:     accountUsername,
      status:       "pending",
      total:        numbers.length,
      processed:    0,
      failed_count: 0,
      error:        null,
      created_at:   now,
      updated_at:   now,
    })
    .execute();

  // ── Queue BullMQ jobs (one per chunk) ───────────────────────
  for (let i = 0; i < chunks.length; i++) {
    const jobData: SmsCampaignJobData = {
      requestId,
      username:      accountUsername,
      broadcastName,
      senderId,
      msg,
      msgMode,
      msgRoutes,
      templateId,
      peid,
      unicode,
      flash,
      scheduleDate,
      scheduleTime,
      chunkIndex:  i,
      totalChunks,
      rows:        chunks[i],
    };

    await smsCampaignInsertQueue.add(
      `insert-${requestId}-chunk-${i}`,
      jobData,
      { priority: 1 },
    );
  }

  return reply.status(202).send({
    status:     1,
    statuscode: 202,
    message:    "SMS campaign submitted successfully. Numbers are being processed in background.",
    data: {
      request_id:    requestId,
      broadcast_name: broadcastName,
      contacts:      numbers.length,
      chunks:        totalChunks,
      schedule_date: scheduleDate,
      schedule_time: scheduleTime,
    },
  });
};

// ── GET /sms/campaigns ─────────────────────────────────────────
export const getSmsCampaigns = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

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

  const query     = req.query as { page?: string; limit?: string; status?: string; search?: string; date_from?: string; date_to?: string };
  const page      = Math.max(1, Number(query.page  ?? 1));
  const limit     = Math.min(200, Math.max(1, Number(query.limit ?? 20)));
  const offset    = (page - 1) * limit;
  const search    = query.search?.trim()    ?? "";
  const dateFrom  = query.date_from?.trim() ?? "";
  const dateTo    = query.date_to?.trim()   ?? "";

  const applyFilters = (qb: any) => {
    if (query.status) qb = qb.where("status", "=", query.status);
    if (search) {
      qb = qb.where((eb: any) => eb.or([
        eb("broadcast_name", "like", `%${search}%`),
        eb("request_id",     "like", `%${search}%`),
        eb("sender_id",      "like", `%${search}%`),
      ]));
    }
    if (dateFrom) qb = qb.where("schedule_date", ">=", dateFrom);
    if (dateTo)   qb = qb.where("schedule_date", "<=", dateTo);
    return qb;
  };

  const baseQ  = (db as any).selectFrom("smpp_campaign_summery").where("username", "=", accountUsername);
  const listQ  = applyFilters(baseQ.selectAll());
  const countQ = applyFilters(
    (db as any)
      .selectFrom("smpp_campaign_summery")
      .select((eb: any) => [eb.fn.count("id").as("total")])
      .where("username", "=", accountUsername),
  );

  const [rows, countRow] = await Promise.all([
    listQ.orderBy("created_at", "desc").limit(limit).offset(offset).execute(),
    countQ.executeTakeFirst(),
  ]);

  return reply.send({
    status: 1,
    data: {
      list:  rows,
      total: Number(countRow?.total ?? 0),
      page,
      limit,
    },
  });
};

// ── GET /sms/campaigns/:requestId/details ─────────────────────
export const getSmsCampaignDetails = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

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

  const { requestId } = req.params as { requestId: string };
  const query  = req.query as { page?: string; limit?: string; status?: string; search?: string };
  const page   = Math.max(1, Number(query.page  ?? 1));
  const limit  = Math.min(500, Math.max(1, Number(query.limit ?? 50)));
  const offset = (page - 1) * limit;
  const search = query.search?.trim() ?? "";

  // Join smpp_sms_engine_logs on rid = message_id for DLR
  let q = (db as any)
    .selectFrom("smpp_campaign_details as cd")
    .leftJoin("smpp_sms_engine_logs as el", "cd.rid", "el.message_id")
    .select([
      "cd.id",
      "cd.receiver",
      "cd.broadcast_name",
      "cd.sender_id",
      "cd.msg",
      "cd.msg_mode",
      "cd.msg_routes",
      "cd.template_id",
      "cd.peid",
      "cd.status",
      "cd.unicode",
      "cd.flash",
      "cd.rid",
      "cd.schedule_date",
      "cd.schedule_time",
      "cd.created_at",
      "cd.updated_at",
      "el.dlr_status",
      "el.dlr_err_code",
      "el.dlr_received_at",
    ])
    .where("cd.username",   "=", accountUsername)
    .where("cd.request_id", "=", requestId);

  if (query.status) q = q.where("cd.status", "=", query.status);
  if (search) {
    q = q.where((eb: any) => eb.or([
      eb("cd.receiver",       "like", `%${search}%`),
      eb("cd.broadcast_name", "like", `%${search}%`),
    ]));
  }

  let countQ = (db as any)
    .selectFrom("smpp_campaign_details")
    .select((eb: any) => [eb.fn.count("id").as("total")])
    .where("username",   "=", accountUsername)
    .where("request_id", "=", requestId);
  if (query.status) countQ = countQ.where("status", "=", query.status);
  if (search) {
    countQ = countQ.where((eb: any) => eb.or([
      eb("receiver",       "like", `%${search}%`),
      eb("broadcast_name", "like", `%${search}%`),
    ]));
  }

  // Status breakdown
  const breakdownQ = (db as any)
    .selectFrom("smpp_campaign_details")
    .select((eb: any) => ["status", eb.fn.count("id").as("count")])
    .where("username",   "=", accountUsername)
    .where("request_id", "=", requestId)
    .groupBy("status");

  const [rows, countRow, breakdown] = await Promise.all([
    q.orderBy("cd.created_at", "asc").limit(limit).offset(offset).execute(),
    countQ.executeTakeFirst(),
    breakdownQ.execute(),
  ]);

  const stats: Record<string, number> = {};
  for (const b of breakdown) stats[b.status ?? "unknown"] = Number(b.count);

  return reply.send({
    status: 1,
    data: {
      list:  rows,
      total: Number(countRow?.total ?? 0),
      page,
      limit,
      stats,
    },
  });
};

// ── GET /sms/campaign/stats ────────────────────────────────────
export const getSmsCampaignStats = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

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

  const query    = req.query as { date_from?: string; date_to?: string };
  const dateFrom = query.date_from?.trim() ?? "";
  const dateTo   = query.date_to?.trim()   ?? "";

  // ── Summary-level stats from smpp_campaign_summery ─────────
  const applyDate = (qb: any) => {
    if (dateFrom) qb = qb.where("schedule_date", ">=", dateFrom);
    if (dateTo)   qb = qb.where("schedule_date", "<=", dateTo);
    return qb;
  };

  const [totalRow, contactsRow, statusRows, topRows] = await Promise.all([
    // total campaigns
    applyDate(
      (db as any).selectFrom("smpp_campaign_summery")
        .select((eb: any) => [eb.fn.count("id").as("total")])
        .where("username", "=", accountUsername),
    ).executeTakeFirst(),

    // total contacts
    applyDate(
      (db as any).selectFrom("smpp_campaign_summery")
        .select((eb: any) => [eb.fn.sum("contacts").as("total_contacts")])
        .where("username", "=", accountUsername),
    ).executeTakeFirst(),

    // campaign status breakdown
    applyDate(
      (db as any).selectFrom("smpp_campaign_summery")
        .select((eb: any) => ["status", eb.fn.count("id").as("count")])
        .where("username", "=", accountUsername)
        .groupBy("status"),
    ).execute(),

    // top 5 campaigns by contacts
    applyDate(
      (db as any).selectFrom("smpp_campaign_summery")
        .select(["broadcast_name", "contacts", "status", "schedule_date", "request_id"])
        .where("username", "=", accountUsername)
        .orderBy("contacts", "desc")
        .limit(5),
    ).execute(),
  ]);

  const statusBreakdown: Record<string, number> = {};
  for (const r of statusRows) statusBreakdown[r.status ?? "unknown"] = Number(r.count);

  return reply.send({
    status: 1,
    data: {
      total_campaigns:  Number(totalRow?.total ?? 0),
      total_contacts:   Number(contactsRow?.total_contacts ?? 0),
      status_breakdown: statusBreakdown,
      top_campaigns:    topRows,
    },
  });
};
