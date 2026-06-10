import type { FastifyRequest, FastifyReply } from "fastify";
import { sql } from "kysely";
import { db } from "../../../models/db.js";

// ── IST timestamp helper ──────────────────────────────────
const IST_OFFSET = 5.5 * 60 * 60 * 1000; // UTC+5:30 in ms

function toIST(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + IST_OFFSET);
  return ist.toISOString().replace("T", " ").replace("Z", "+05:30");
}

function withIST<T extends Record<string, any>>(row: T, fields: (keyof T)[]): T {
  const out = { ...row };
  for (const f of fields) out[f] = toIST(row[f] as any) as any;
  return out;
}

// ── Batch-fetch assigned_agent from leads ─────────────────
// Match: leads.username = accountUsername  AND  leads.phone = cms.receiver_id
// Uses composite key `username:phone` internally so cross-account
// conflicts are impossible even if phones overlap between accounts.
interface LeadInfo {
  assigned_agent: string | null;
  lead_status:    string | null;
  lead_score:     number | null;
}

// Normalize phone — strip leading + to match leads table storage
function normalizePhone(p: string | null | undefined): string | null {
  return p ? p.trim().replace(/^\+/, "") : null;
}

async function buildLeadInfoMap(
  username: string,
  rawPhones: string[],
): Promise<Map<string, LeadInfo>> {
  // Map keyed by RAW phone (as stored in receiver_id) for easy lookup
  const map = new Map<string, LeadInfo>();
  if (!rawPhones.length) return map;

  // Normalize: strip leading + so they match leads.phone
  const normalized = rawPhones.map(p => normalizePhone(p)).filter(Boolean) as string[];
  // Build reverse map: normalized → raw (for keying results back)
  const normToRaw = new Map<string, string>();
  for (const raw of rawPhones) {
    const norm = normalizePhone(raw);
    if (norm) normToRaw.set(norm, raw);
  }

  const leads: any[] = await (db as any)
    .selectFrom("leads")
    .select(["phone", "assigned_agent", "status", "lead_score"])
    .where("username",     "=",       username)     // leads.username = cms.username
    .where("phone",        "in",      normalized)   // normalized leads.phone
    .where("is_duplicate", "=",       0)            // prefer primary leads
    .orderBy("id", "desc")                          // most-recent primary wins
    .execute();

  for (const l of leads) {
    if (!l.phone) continue;
    const raw = normToRaw.get(l.phone) ?? l.phone;
    if (!map.has(raw)) {
      map.set(raw, {
        assigned_agent: l.assigned_agent ?? null,
        lead_status:    l.status         ?? null,
        lead_score:     l.lead_score != null ? Number(l.lead_score) : null,
      });
    }
  }
  return map;
}

// ── Attach lead info to each conversation row ─────────────
async function attachLeadInfo(
  rows: any[],
  username: string,      // always the master account username
): Promise<any[]> {
  const phones = [...new Set(rows.map((r: any) => r.receiver_id).filter(Boolean))];
  const infoMap = await buildLeadInfoMap(username, phones);
  return rows.map((r: any) => {
    const info = infoMap.get(r.receiver_id);
    return {
      ...r,
      assigned_agent: info?.assigned_agent ?? null,
      lead_status:    info?.lead_status    ?? null,
      lead_score:     info?.lead_score     ?? null,
    };
  });
}

// ============================================================
// GET /api/webhook/auth/inbox
// ============================================================
export const listConversations = async (
  req: FastifyRequest<{
    Querystring: {
      page?:     string;
      limit?:    string;
      channel?:  string;
      status?:   string;
      unread?:   string;
      starred?:  string;
      search?:   string;
    };
  }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  const userType = (req.user as any)?.user_type as number | undefined;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  // ── Agent hierarchy ─────────────────────────────────────────
  // Agents (user_type=5) see conversations under their parent account
  // but only for contacts whose lead is assigned to them.
  let accountUsername: string = username;
  let agentUsername:   string | null = null;
  let assignedPhones:  string[] | null = null;

  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    accountUsername = parentRow?.parent_username ?? username;
    agentUsername   = username;

    // Fetch phones of leads assigned to this agent under the master account.
    // Include duplicates so agents see conversations for ALL their assigned leads.
    const assignedLeads: any[] = await (db as any)
      .selectFrom("leads")
      .select(["phone"])
      .where("username",       "=", accountUsername)
      .where("assigned_agent", "=", agentUsername)
      .execute();

    assignedPhones = assignedLeads
      .map((l: any) => l.phone)
      .filter(Boolean);
  }

  const page   = Math.max(1, parseInt(req.query.page  || "1"));
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || "30")));
  const offset = (page - 1) * limit;
  const { channel, status, unread, starred, search } = req.query;

  try {
    let query = (db as any)
      .selectFrom("chat_message_summary")
      .select([
        "id", "conversation_id", "channel", "sender_id", "receiver_id",
        "contact_name", "last_message", "last_message_type",
        "last_message_at", "last_message_dir", "session_message_time",
        "is_read", "unread_count", "is_starred",
        "conv_status", "assigned_to", "tags",
        "created_at", "updated_at",
      ])
      .where("username", "=", accountUsername)
      .orderBy("last_message_at", "desc");

    // Agents: filter to conversations belonging to their assigned leads
    if (assignedPhones !== null) {
      if (assignedPhones.length === 0) {
        // Agent has no assigned leads → empty inbox
        return reply.send({ status: 1, data: [], total: 0, page, limit });
      }
      query = query.where("receiver_id", "in", assignedPhones);
    }

    if (channel && channel !== "all") query = query.where("channel", "=", channel);
    if (status  && status  !== "all") {
      if (status === "active") {
        // "active" = everything except resolved — includes open, assigned, pending
        query = query.where("conv_status", "!=", "resolved");
      } else {
        query = query.where("conv_status", "=", status);
      }
    }
    if (unread  === "1")              query = query.where("is_read",     "=", 0);
    if (starred === "1")              query = query.where("is_starred",  "=", 1);
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      query = query.where((eb: any) =>
        eb.or([
          eb("contact_name", "like", term),
          eb("receiver_id",  "like", term),
          eb("last_message", "like", term),
        ])
      );
    }

    // Count must apply the same filters as the main query for correct pagination
    let countQuery = (db as any)
      .selectFrom("chat_message_summary")
      .select((eb: any) => eb.fn.count("id").as("count"))
      .where("username", "=", accountUsername);

    if (assignedPhones !== null && assignedPhones.length > 0) {
      countQuery = countQuery.where("receiver_id", "in", assignedPhones);
    }
    if (channel && channel !== "all") countQuery = countQuery.where("channel", "=", channel);
    if (status  && status  !== "all") {
      if (status === "active") {
        countQuery = countQuery.where("conv_status", "!=", "resolved");
      } else {
        countQuery = countQuery.where("conv_status", "=", status);
      }
    }
    if (unread  === "1")              countQuery = countQuery.where("is_read",     "=", 0);
    if (starred === "1")              countQuery = countQuery.where("is_starred",  "=", 1);
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      countQuery = countQuery.where((eb: any) =>
        eb.or([
          eb("contact_name", "like", term),
          eb("receiver_id",  "like", term),
          eb("last_message", "like", term),
        ])
      );
    }

    const [conversations, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).execute(),
      countQuery.executeTakeFirst(),
    ]);

    const total      = Number(totalResult?.count ?? 0);
    const totalPages = Math.ceil(total / limit);

    const CONV_TS = ["last_message_at", "session_message_time", "created_at", "updated_at"] as const;
    const enriched = await attachLeadInfo(conversations, accountUsername);

    return reply.send({
      status: 1, statuscode: 200,
      message: "Conversations fetched",
      data: enriched.map((c: any) => withIST(c, CONV_TS as any)),
      pagination: { page, limit, total, total_pages: totalPages, has_next: page < totalPages, has_prev: page > 1 },
    });
  } catch (err: any) {
    console.error("[inbox] listConversations:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to fetch conversations" });
  }
};

// ============================================================
// GET /api/webhook/auth/inbox/:conversationId/messages
// ============================================================
export const getConversationMessages = async (
  req: FastifyRequest<{
    Params:      { conversationId: string };
    Querystring: { page?: string; limit?: string };
  }>,
  reply: FastifyReply,
) => {
  const rawUsername      = req.user?.username;
  const userType         = (req.user as any)?.user_type as number | undefined;
  const { conversationId } = req.params;
  if (!rawUsername) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  // Agents: messages stored under parent account
  let username = rawUsername;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users").select(["parent_username"])
      .where("username", "=", rawUsername).executeTakeFirst();
    username = parentRow?.parent_username ?? rawUsername;
  }

  const page   = Math.max(1, parseInt(req.query.page  || "1"));
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || "50")));
  const offset = (page - 1) * limit;

  try {
    const [messages, totalResult] = await Promise.all([
      (db as any)
        .selectFrom("chat_messages")
        .select([
          "id", "channel", "message_id", "sender_id", "receiver_id",
          "contact_name", "type", "text", "media_url", "media_filename",
          "media_mime", "reaction_emoji", "location_lat", "location_lng",
          "location_name", "template_name", "direction", "status",
          "platform_timestamp", "created_at",
        ])
        .where("conversation_id", "=", conversationId)
        .where("username",        "=", username)
        .where("is_deleted",      "=", 0)
        .orderBy("created_at", "asc")
        .limit(limit)
        .offset(offset)
        .execute(),

      (db as any)
        .selectFrom("chat_messages")
        .select((eb: any) => eb.fn.count("id").as("count"))
        .where("conversation_id", "=", conversationId)
        .where("username",        "=", username)
        .where("is_deleted",      "=", 0)
        .executeTakeFirst(),
    ]);

    const total      = Number(totalResult?.count ?? 0);
    const totalPages = Math.ceil(total / limit);

    // Auto mark as read
    (db as any)
      .updateTable("chat_message_summary")
      .set({ is_read: 1, unread_count: 0, updated_at: new Date() })
      .where("conversation_id", "=", conversationId)
      .where("username",        "=", username)
      .execute().catch(() => {});

    const MSG_TS = ["platform_timestamp", "created_at"] as const;
    return reply.send({
      status: 1, statuscode: 200,
      message: "Messages fetched",
      data: messages.map((m: any) => withIST(m, MSG_TS as any)),
      pagination: { page, limit, total, total_pages: totalPages, has_next: page < totalPages, has_prev: page > 1 },
    });
  } catch (err: any) {
    console.error("[inbox] getConversationMessages:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to fetch messages" });
  }
};

// ============================================================
// PUT /api/webhook/auth/inbox/:conversationId/read
// ============================================================
export const markAsRead = async (
  req: FastifyRequest<{ Params: { conversationId: string } }>,
  reply: FastifyReply,
) => {
  const rawUsername = req.user?.username;
  const userType    = (req.user as any)?.user_type as number | undefined;
  const { conversationId } = req.params;
  if (!rawUsername) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  let username = rawUsername;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users").select(["parent_username"])
      .where("username", "=", rawUsername).executeTakeFirst();
    username = parentRow?.parent_username ?? rawUsername;
  }

  await (db as any)
    .updateTable("chat_message_summary")
    .set({ is_read: 1, unread_count: 0, updated_at: new Date() })
    .where("conversation_id", "=", conversationId)
    .where("username",        "=", username)
    .execute();

  return reply.send({ status: 1, message: "Marked as read" });
};

// ============================================================
// PUT /api/webhook/auth/inbox/:conversationId/star
// ============================================================
export const toggleStar = async (
  req: FastifyRequest<{ Params: { conversationId: string }; Body: { is_starred: boolean } }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  const { conversationId } = req.params;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const isStarred = req.body?.is_starred ? 1 : 0;

  await (db as any)
    .updateTable("chat_message_summary")
    .set({ is_starred: isStarred, updated_at: new Date() })
    .where("conversation_id", "=", conversationId)
    .where("username",        "=", username)
    .execute();

  return reply.send({ status: 1, message: isStarred ? "Starred" : "Unstarred" });
};

// ============================================================
// PUT /api/webhook/auth/inbox/:conversationId/assign
// Body: { assigned_to: string }
// Writes to leads.assigned_agent — no sync into chat_message_summary
// ============================================================
export const assignConversation = async (
  req: FastifyRequest<{ Params: { conversationId: string }; Body: { assigned_to: string } }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  const { conversationId } = req.params;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const assignedTo = req.body?.assigned_to?.trim() ?? "";

  // Get customer phone from conversation
  const conv: any = await (db as any)
    .selectFrom("chat_message_summary")
    .select(["receiver_id"])
    .where("conversation_id", "=", conversationId)
    .where("username",        "=", username)
    .executeTakeFirst();

  if (!conv?.receiver_id) {
    return reply.status(404).send({ status: 0, message: "Conversation not found" });
  }

  const isUnassign = assignedTo === "";

  // Update chat_message_summary.assigned_to — always reliable regardless of whether a lead exists
  await (db as any)
    .updateTable("chat_message_summary")
    .set({
      assigned_to: isUnassign ? null : assignedTo,
      conv_status: isUnassign ? "open" : "assigned",
      updated_at:  new Date(),
    })
    .where("conversation_id", "=", conversationId)
    .where("username",        "=", username)
    .execute();

  // Best-effort: sync to leads.assigned_agent as well
  const customerPhone = normalizePhone(conv.receiver_id) ?? conv.receiver_id;
  await (db as any)
    .updateTable("leads")
    .set({ assigned_agent: isUnassign ? null : assignedTo, updated_at: new Date() })
    .where("username", "=", username)
    .where("phone",    "=", customerPhone)
    .execute();

  return reply.send({ status: 1, message: isUnassign ? "Conversation unassigned" : "Conversation assigned" });
};

// ============================================================
// PUT /api/webhook/auth/inbox/:conversationId/resolve
// ============================================================
export const resolveConversation = async (
  req: FastifyRequest<{ Params: { conversationId: string } }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  const { conversationId } = req.params;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .updateTable("chat_message_summary")
    .set({ conv_status: "resolved", resolved_at: new Date(), updated_at: new Date() })
    .where("conversation_id", "=", conversationId)
    .where("username",        "=", username)
    .execute();

  return reply.send({ status: 1, message: "Conversation resolved" });
};

// ============================================================
// PUT /api/webhook/auth/inbox/:conversationId/notes
// ============================================================
export const updateNotes = async (
  req: FastifyRequest<{ Params: { conversationId: string }; Body: { notes: string } }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  const { conversationId } = req.params;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .updateTable("chat_message_summary")
    .set({ notes: req.body?.notes ?? null, updated_at: new Date() })
    .where("conversation_id", "=", conversationId)
    .where("username",        "=", username)
    .execute();

  return reply.send({ status: 1, message: "Notes updated" });
};

// ============================================================
// GET /api/webhook/auth/team-inbox
// agent filter → leads.assigned_agent (not chat_message_summary.assigned_to)
// ============================================================
export const listTeamInbox = async (
  req: FastifyRequest<{
    Querystring: {
      page?:    string;
      limit?:   string;
      channel?: string;
      status?:  string;
      unread?:  string;
      agent?:   string;
      search?:  string;
    };
  }>,
  reply: FastifyReply,
) => {
  const user = req.user;
  if (!user?.username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const page   = Math.max(1, parseInt(req.query.page  || "1"));
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || "30")));
  const offset = (page - 1) * limit;
  const { channel, status, unread, search } = req.query;

  const userRow: any = await (db as any)
    .selectFrom("users")
    .select(["user_type", "parent_username"])
    .where("username", "=", user.username)
    .executeTakeFirst();

  const isAgent       = userRow?.user_type === 5;
  const assignFilter  = isAgent ? user.username : (req.query.agent?.trim() ?? null);
  const accountUsername = isAgent ? (userRow?.parent_username ?? user.username) : user.username;

  try {
    let query = (db as any)
      .selectFrom("chat_message_summary")
      .select([
        "id", "conversation_id", "channel", "sender_id", "receiver_id",
        "contact_name", "last_message", "last_message_type",
        "last_message_at", "last_message_dir", "session_message_time",
        "is_read", "unread_count", "is_starred",
        "conv_status", "assigned_to", "tags", "notes",
        "created_at", "updated_at",
      ])
      .where("username", "=", accountUsername)
      .orderBy("last_message_at", "desc");

    // Filter by leads.assigned_agent:
    //   agents  → show open (unassigned) conversations to everyone on the team
    //             PLUS conversations assigned to this specific agent
    //   admins  → if ?agent= is passed, filter strictly to that agent only
    if (assignFilter) {
      // REPLACE(receiver_id, '+', '') normalizes +91xxx → 91xxx so it matches leads.phone
      const assignedSubQ = (db as any)
        .selectFrom("leads")
        .select("phone")
        .where("username",       "=", accountUsername)
        .where("assigned_agent", "=", assignFilter)
        .where("phone",          "is not", null);

      if (isAgent) {
        // Agents see: their own assigned convs  OR  open/unassigned convs
        query = query.where((eb: any) =>
          eb.or([
            eb(sql`REPLACE(receiver_id, '+', '')`, "in", assignedSubQ),
            eb("conv_status", "=", "open"),
          ])
        );
      } else {
        // Admin explicit agent filter — strict
        query = query.where(sql`REPLACE(receiver_id, '+', '')`, "in", assignedSubQ);
      }
    }

    if (channel && channel !== "all") query = query.where("channel", "=", channel);
    if (status  && status  !== "all") {
      if (status === "active") {
        query = query.where("conv_status", "!=", "resolved");
      } else {
        query = query.where("conv_status", "=", status);
      }
    }
    if (unread  === "1")              query = query.where("is_read",     "=", 0);
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      query = query.where((eb: any) =>
        eb.or([
          eb("contact_name", "like", term),
          eb("receiver_id",  "like", term),
          eb("last_message", "like", term),
        ])
      );
    }

    const assignedSubQCount = assignFilter
      ? (db as any)
          .selectFrom("leads")
          .select("phone")
          .where("username",       "=", accountUsername)
          .where("assigned_agent", "=", assignFilter)
          .where("phone",          "is not", null)
      : null;

    let countQ = (db as any)
      .selectFrom("chat_message_summary")
      .select((eb: any) => eb.fn.count("id").as("count"))
      .where("username", "=", accountUsername);

    if (assignFilter) {
      if (isAgent) {
        countQ = countQ.where((eb: any) =>
          eb.or([
            eb(sql`REPLACE(receiver_id, '+', '')`, "in", assignedSubQCount),
            eb("conv_status", "=", "open"),
          ])
        );
      } else {
        countQ = countQ.where(sql`REPLACE(receiver_id, '+', '')`, "in", assignedSubQCount);
      }
    }
    if (status && status !== "all") {
      if (status === "active") {
        countQ = countQ.where("conv_status", "!=", "resolved");
      } else {
        countQ = countQ.where("conv_status", "=", status);
      }
    }
    if (unread === "1") countQ = countQ.where("is_read", "=", 0);

    const [rows, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).execute(),
      countQ.executeTakeFirst(),
    ]);

    const total      = Number(totalResult?.count ?? 0);
    const totalPages = Math.ceil(total / limit);

    const CONV_TS = ["last_message_at", "session_message_time", "created_at", "updated_at"] as const;
    const enriched = await attachLeadInfo(rows, accountUsername);

    return reply.send({
      status: 1, statuscode: 200,
      message: "Team inbox fetched",
      meta: {
        viewing_as:   isAgent ? "agent" : "admin",
        agent_filter: assignFilter,
        account:      accountUsername,
      },
      data: enriched.map((c: any) => withIST(c, CONV_TS as any)),
      pagination: { page, limit, total, total_pages: totalPages, has_next: page < totalPages, has_prev: page > 1 },
    });
  } catch (err: any) {
    console.error("[inbox] listTeamInbox:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to fetch team inbox" });
  }
};
