import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { sql } from "kysely";

type AnalyticsQuery = {
  from?: string;
  to?: string;
  period?: "day" | "week" | "month";
};

function getUsername(req: FastifyRequest): string | null {
  return (req as any).user?.username ?? null;
}

async function resolveAccountUsername(req: FastifyRequest): Promise<string | null> {
  const username = getUsername(req);
  if (!username) return null;
  const userType = (req as any).user?.user_type as number | undefined;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    return parentRow?.parent_username ?? username;
  }
  return username;
}

function applyDateRange(
  query: any,
  from?: string,
  to?: string,
  col = "created_at",
) {
  if (from) {
    const d = new Date(from);
    if (!isNaN(d.getTime())) query = query.where(col, ">=", d);
  }
  if (to) {
    const d = new Date(to);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      query = query.where(col, "<=", d);
    }
  }
  return query;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/overview
// Summary cards: leads, conversations, messages, agents, new-today
// ─────────────────────────────────────────────────────────────────────────────
export const getAnalyticsOverview = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Total leads (non-duplicate)
  let leadsQ = (db as any).selectFrom("leads").where("username", "=", username).where("is_duplicate", "=", 0);
  leadsQ = applyDateRange(leadsQ, from, to);
  const leadsResult = await leadsQ.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();

  // Converted leads
  let convLeadsQ = (db as any).selectFrom("leads").where("username", "=", username).where("is_duplicate", "=", 0).where("is_converted", "=", 1);
  convLeadsQ = applyDateRange(convLeadsQ, from, to);
  const convResult = await convLeadsQ.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();

  // Total conversations
  let convsQ = (db as any).selectFrom("chat_message_summary").where("username", "=", username);
  convsQ = applyDateRange(convsQ, from, to);
  const convsResult = await convsQ.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();

  // Total messages
  let msgsQ = (db as any).selectFrom("chat_messages").where("username", "=", username);
  msgsQ = applyDateRange(msgsQ, from, to);
  const msgsResult = await msgsQ.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();

  // Inbound messages
  let inboundQ = (db as any).selectFrom("chat_messages").where("username", "=", username).where("direction", "=", "inbound");
  inboundQ = applyDateRange(inboundQ, from, to);
  const inboundResult = await inboundQ.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();

  // Agents count
  const agentsResult = await (db as any)
    .selectFrom("users")
    .where("parent_username", "=", username)
    .where("user_type", "=", 5)
    .select((eb: any) => eb.fn.countAll().as("cnt"))
    .executeTakeFirst();

  // New leads today
  const newTodayResult = await (db as any)
    .selectFrom("leads")
    .where("username", "=", username)
    .where("is_duplicate", "=", 0)
    .where("created_at", ">=", todayStart)
    .select((eb: any) => eb.fn.countAll().as("cnt"))
    .executeTakeFirst();

  // Open conversations
  const openResult = await (db as any)
    .selectFrom("chat_message_summary")
    .where("username", "=", username)
    .where("conv_status", "=", "open")
    .select((eb: any) => eb.fn.countAll().as("cnt"))
    .executeTakeFirst();

  // Unread conversations
  const unreadResult = await (db as any)
    .selectFrom("chat_message_summary")
    .where("username", "=", username)
    .where("is_read", "=", 0)
    .select((eb: any) => eb.fn.countAll().as("cnt"))
    .executeTakeFirst();

  const totalLeads = Number(leadsResult?.cnt ?? 0);
  const totalConverted = Number(convResult?.cnt ?? 0);
  const totalMessages = Number(msgsResult?.cnt ?? 0);
  const totalInbound = Number(inboundResult?.cnt ?? 0);

  return reply.send({
    status: 1,
    data: {
      total_leads: totalLeads,
      converted_leads: totalConverted,
      conversion_rate: totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) + "%" : "0%",
      total_conversations: Number(convsResult?.cnt ?? 0),
      open_conversations: Number(openResult?.cnt ?? 0),
      unread_conversations: Number(unreadResult?.cnt ?? 0),
      total_messages: totalMessages,
      inbound_messages: totalInbound,
      outbound_messages: totalMessages - totalInbound,
      total_agents: Number(agentsResult?.cnt ?? 0),
      new_leads_today: Number(newTodayResult?.cnt ?? 0),
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/messages-trend?from=&to=&period=day
// Messages per day (inbound + outbound) — for line chart
// ─────────────────────────────────────────────────────────────────────────────
export const getMessagesTrend = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  // Default: last 30 days
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 29);
  defaultFrom.setHours(0, 0, 0, 0);

  const fromDate = from ? new Date(from) : defaultFrom;
  const toDate = to ? (() => { const d = new Date(to); d.setHours(23, 59, 59, 999); return d; })() : new Date();

  const rows = await (db as any)
    .selectFrom("chat_messages")
    .where("username", "=", username)
    .where("created_at", ">=", fromDate)
    .where("created_at", "<=", toDate)
    .select([
      sql`DATE(created_at)`.as("date"),
      "direction",
      sql`COUNT(*)`.as("cnt"),
    ])
    .groupBy([sql`DATE(created_at)`, "direction"])
    .orderBy(sql`DATE(created_at)`, "asc")
    .execute();

  // Pivot by date
  const map: Record<string, { date: string; inbound: number; outbound: number }> = {};
  for (const row of rows) {
    const d = String(row.date);
    if (!map[d]) map[d] = { date: d, inbound: 0, outbound: 0 };
    if (row.direction === "inbound") map[d].inbound = Number(row.cnt);
    else map[d].outbound = Number(row.cnt);
  }

  return reply.send({ status: 1, data: Object.values(map) });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/channel-breakdown?from=&to=
// Messages and conversations per channel — for pie/bar chart
// ─────────────────────────────────────────────────────────────────────────────
export const getChannelBreakdown = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  let msgQ = (db as any)
    .selectFrom("chat_messages")
    .where("username", "=", username)
    .select(["channel", sql`COUNT(*)`.as("message_count")])
    .groupBy("channel");
  msgQ = applyDateRange(msgQ, from, to);
  const msgRows = await msgQ.execute();

  let convQ = (db as any)
    .selectFrom("chat_message_summary")
    .where("username", "=", username)
    .select(["channel", sql`COUNT(*)`.as("conversation_count")])
    .groupBy("channel");
  convQ = applyDateRange(convQ, from, to);
  const convRows = await convQ.execute();

  const convMap: Record<string, number> = {};
  for (const r of convRows) convMap[r.channel] = Number(r.conversation_count);

  const channelMap: Record<string, { message_count: number; conversation_count: number; lead_count: number }> = {};

  for (const r of msgRows) {
    const ch = r.channel ?? "unknown";
    channelMap[ch] = { message_count: Number(r.message_count), conversation_count: convMap[ch] ?? 0, lead_count: 0 };
  }
  // patch conversation counts for channels that only appear in summary
  for (const [ch, cnt] of Object.entries(convMap)) {
    if (!channelMap[ch]) channelMap[ch] = { message_count: 0, conversation_count: cnt, lead_count: 0 };
  }

  // Also include leads from Meta / Facebook / Instagram lead-form sources
  let metaLeadsQ = (db as any)
    .selectFrom("leads")
    .where("username", "=", username)
    .where("is_duplicate", "=", 0)
    .where(sql`source IN ('meta', 'facebook', 'instagram')`)
    .select(["source", sql`COUNT(*)`.as("lead_count")])
    .groupBy("source");
  metaLeadsQ = applyDateRange(metaLeadsQ, from, to, "created_at");
  const leadsRows: any[] = await metaLeadsQ.execute();
  for (const r of leadsRows) {
    const ch: string = r.source === "meta" ? "facebook" : r.source; // map "meta" → "facebook"
    if (!channelMap[ch]) channelMap[ch] = { message_count: 0, conversation_count: 0, lead_count: 0 };
    channelMap[ch].lead_count += Number(r.lead_count);
  }

  const data = Object.entries(channelMap).map(([channel, v]) => ({
    channel,
    message_count: v.message_count,
    conversation_count: v.conversation_count,
    lead_count: v.lead_count,
  }));

  return reply.send({ status: 1, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/lead-funnel?from=&to=
// Lead count per status stage — for funnel/bar chart
// ─────────────────────────────────────────────────────────────────────────────
export const getLeadFunnel = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  let q = (db as any)
    .selectFrom("leads")
    .where("username", "=", username)
    .where("is_duplicate", "=", 0);
  q = applyDateRange(q, from, to);

  const rows = await q
    .select(["status", sql`COUNT(*)`.as("count")])
    .groupBy("status")
    .orderBy(sql`COUNT(*)`, "desc")
    .execute();

  // Define preferred funnel order
  const order = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Closed", "Lost"];
  const map: Record<string, number> = {};
  for (const r of rows) map[r.status ?? "Unknown"] = Number(r.count);

  // Put known statuses first in funnel order, then any others
  const known = order.filter((s) => s in map).map((s) => ({ status: s, count: map[s] }));
  const others = rows
    .filter((r: any) => !order.includes(r.status))
    .map((r: any) => ({ status: r.status ?? "Unknown", count: Number(r.count) }));

  return reply.send({ status: 1, data: [...known, ...others] });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/lead-score-distribution?from=&to=
// Lead score histogram — bucket of 10
// ─────────────────────────────────────────────────────────────────────────────
export const getLeadScoreDistribution = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  let q = (db as any)
    .selectFrom("leads")
    .where("username", "=", username)
    .where("is_duplicate", "=", 0);
  q = applyDateRange(q, from, to);

  const rows = await q
    .select([
      sql`FLOOR(lead_score / 10) * 10`.as("bucket_start"),
      sql`COUNT(*)`.as("count"),
    ])
    .groupBy(sql`FLOOR(lead_score / 10) * 10`)
    .orderBy(sql`FLOOR(lead_score / 10) * 10`, "asc")
    .execute();

  const data = rows.map((r: any) => {
    const start = Number(r.bucket_start);
    return { range: `${start}-${start + 9}`, count: Number(r.count) };
  });

  return reply.send({ status: 1, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/conversation-status?from=&to=
// Conversations by status — for donut chart
// ─────────────────────────────────────────────────────────────────────────────
export const getConversationStatus = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  let q = (db as any)
    .selectFrom("chat_message_summary")
    .where("username", "=", username);
  q = applyDateRange(q, from, to);

  const rows = await q
    .select(["conv_status", sql`COUNT(*)`.as("count")])
    .groupBy("conv_status")
    .execute();

  const data = rows.map((r: any) => ({
    status: r.conv_status ?? "unknown",
    count: Number(r.count),
  }));

  return reply.send({ status: 1, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/agent-performance?from=&to=
// Per-agent: leads assigned, leads converted, conversations resolved
// ─────────────────────────────────────────────────────────────────────────────
export const getAgentPerformance = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  // Leads per agent
  let leadsQ = (db as any)
    .selectFrom("leads")
    .where("username", "=", username)
    .where("is_duplicate", "=", 0)
    .where("assigned_agent", "is not", null);
  leadsQ = applyDateRange(leadsQ, from, to);

  const leadsRows = await leadsQ
    .select([
      "assigned_agent",
      sql`COUNT(*)`.as("total"),
      sql`SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END)`.as("converted"),
    ])
    .groupBy("assigned_agent")
    .orderBy(sql`COUNT(*)`, "desc")
    .execute();

  // Resolved conversations per agent
  let resolvedQ = (db as any)
    .selectFrom("chat_message_summary")
    .where("username", "=", username)
    .where("conv_status", "=", "resolved")
    .where("assigned_to", "is not", null);
  resolvedQ = applyDateRange(resolvedQ, from, to);

  const resolvedRows = await resolvedQ
    .select(["assigned_to", sql`COUNT(*)`.as("resolved")])
    .groupBy("assigned_to")
    .execute();

  const resolvedMap: Record<string, number> = {};
  for (const r of resolvedRows) resolvedMap[r.assigned_to] = Number(r.resolved);

  const data = leadsRows.map((r: any) => {
    const total = Number(r.total);
    const converted = Number(r.converted);
    return {
      agent: r.assigned_agent,
      leads_assigned: total,
      leads_converted: converted,
      conversations_resolved: resolvedMap[r.assigned_agent] ?? 0,
      conversion_rate: total > 0 ? ((converted / total) * 100).toFixed(1) + "%" : "0%",
    };
  });

  return reply.send({ status: 1, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/leads-trend?from=&to=
// New + converted leads per day — for line chart
// ─────────────────────────────────────────────────────────────────────────────
export const getLeadsTrend = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 29);
  defaultFrom.setHours(0, 0, 0, 0);

  const fromDate = from ? new Date(from) : defaultFrom;
  const toDate = to ? (() => { const d = new Date(to); d.setHours(23, 59, 59, 999); return d; })() : new Date();

  const rows = await (db as any)
    .selectFrom("leads")
    .where("username", "=", username)
    .where("is_duplicate", "=", 0)
    .where("created_at", ">=", fromDate)
    .where("created_at", "<=", toDate)
    .select([
      sql`DATE(created_at)`.as("date"),
      sql`COUNT(*)`.as("new_leads"),
      sql`SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END)`.as("converted"),
    ])
    .groupBy(sql`DATE(created_at)`)
    .orderBy(sql`DATE(created_at)`, "asc")
    .execute();

  const data = rows.map((r: any) => ({
    date: String(r.date),
    new_leads: Number(r.new_leads),
    converted: Number(r.converted),
  }));

  return reply.send({ status: 1, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/lead-source-performance?from=&to=
// Lead count + conversion rate by source channel — for bar chart
// ─────────────────────────────────────────────────────────────────────────────
export const getLeadSourcePerformance = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  let q = (db as any)
    .selectFrom("leads")
    .where("username", "=", username)
    .where("is_duplicate", "=", 0);
  q = applyDateRange(q, from, to);

  const rows = await q
    .select([
      "source",
      sql`COUNT(*)`.as("total"),
      sql`SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END)`.as("converted"),
      sql`AVG(lead_score)`.as("avg_score"),
    ])
    .groupBy("source")
    .orderBy(sql`COUNT(*)`, "desc")
    .execute();

  const data = rows.map((r: any) => {
    const total = Number(r.total);
    const converted = Number(r.converted);
    return {
      source: r.source ?? "Unknown",
      total_leads: total,
      converted_leads: converted,
      conversion_rate: total > 0 ? ((converted / total) * 100).toFixed(1) + "%" : "0%",
      avg_lead_score: parseFloat((Number(r.avg_score) || 0).toFixed(1)),
    };
  });

  return reply.send({ status: 1, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/message-type-breakdown?from=&to=
// Message types (text/image/video/document/audio) — for donut chart
// ─────────────────────────────────────────────────────────────────────────────
export const getMessageTypeBreakdown = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  let q = (db as any)
    .selectFrom("chat_messages")
    .where("username", "=", username);
  q = applyDateRange(q, from, to);

  const rows = await q
    .select(["type", sql`COUNT(*)`.as("count")])
    .groupBy("type")
    .orderBy(sql`COUNT(*)`, "desc")
    .execute();

  const data = rows.map((r: any) => ({
    type: r.type ?? "unknown",
    count: Number(r.count),
  }));

  return reply.send({ status: 1, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/hourly-activity?from=&to=
// Messages by hour of day (0-23) — for heatmap/bar chart
// ─────────────────────────────────────────────────────────────────────────────
export const getHourlyActivity = async (
  req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { from, to } = req.query;

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 29);
  defaultFrom.setHours(0, 0, 0, 0);

  const fromDate = from ? new Date(from) : defaultFrom;
  const toDate = to ? (() => { const d = new Date(to); d.setHours(23, 59, 59, 999); return d; })() : new Date();

  const rows = await (db as any)
    .selectFrom("chat_messages")
    .where("username", "=", username)
    .where("created_at", ">=", fromDate)
    .where("created_at", "<=", toDate)
    .select([
      sql`HOUR(created_at)`.as("hour"),
      sql`COUNT(*)`.as("count"),
    ])
    .groupBy(sql`HOUR(created_at)`)
    .orderBy(sql`HOUR(created_at)`, "asc")
    .execute();

  // Fill all 24 hours
  const map: Record<number, number> = {};
  for (const r of rows) map[Number(r.hour)] = Number(r.count);

  const data = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, "0")}:00`,
    count: map[h] ?? 0,
  }));

  return reply.send({ status: 1, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/auth/analytics/recent-activity?limit=10
// Latest 10 leads + latest 10 conversations — for activity feed
// ─────────────────────────────────────────────────────────────────────────────
export const getRecentActivity = async (
  req: FastifyRequest<{ Querystring: { limit?: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const limit = Math.min(20, parseInt(req.query.limit ?? "10", 10));

  const recentLeads = await (db as any)
    .selectFrom("leads")
    .where("username", "=", username)
    .where("is_duplicate", "=", 0)
    .select(["id", "full_name", "phone", "source", "status", "lead_score", "created_at"])
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();

  const recentConversations = await (db as any)
    .selectFrom("chat_message_summary")
    .where("username", "=", username)
    .select(["conversation_id", "channel", "receiver_id", "contact_name", "last_message", "last_message_type", "conv_status", "last_message_at"])
    .orderBy("last_message_at", "desc")
    .limit(limit)
    .execute();

  return reply.send({
    status: 1,
    data: {
      recent_leads: recentLeads,
      recent_conversations: recentConversations,
    },
  });
};
