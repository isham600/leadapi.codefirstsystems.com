// controllers/leads.controller.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { sql } from "kysely";
import { db } from "../../../models/db.js";

export interface LeadsQuery {
  page?: string;
  limit?: string;
  search?: string;

  tenant_id?: string;
  country_code?: string;
  status?: string;
  priority?: string;
  medium?: string;
  source?: string;
  sub_source?: string;
  campaign?: string;
  city?: string;

  is_duplicate?: string;
  is_converted?: string;

  min_score?: string;
  max_score?: string;

  first_contacted_from?: string;
  first_contacted_to?: string;

  last_contacted_from?: string;
  last_contacted_to?: string;

  next_followup_from?: string;
  next_followup_to?: string;

  created_from?: string;
  created_to?: string;

  owner_id?: string;
  assigned_agent?: string;

  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// ============================================================
// 🔄 GET LEADS CONTROLLER
// ============================================================


 
export const getLeads = async (
  req: FastifyRequest<{ Querystring: LeadsQuery }>,
  reply: FastifyReply
) => {
  try {
    const owner_username = req.user?.username;
    const userType       = (req.user as any)?.user_type as number | undefined;

    if (!owner_username) {
      return reply.status(401).send({
        status: 0, statuscode: 401, message: "Unauthorized user",
        error: "unauthorized", data: null, validation: null,
      });
    }

    // ── Agent hierarchy: resolve master account username ──────
    // Agents (user_type=5) store data under their parent's username.
    // Their leads are identified by assigned_agent = agent's username.
    let accountUsername: string = owner_username;
    let agentFilter:     string | null = null;

    if (userType === 5) {
      const parentRow: any = await (db as any)
        .selectFrom("users")
        .select(["parent_username"])
        .where("username", "=", owner_username)
        .executeTakeFirst();
      accountUsername = parentRow?.parent_username ?? owner_username;
      agentFilter     = owner_username;
    }

    // Extract query params
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "20", 10);

    const {
      search,
      tenant_id,
      country_code,
      status,
      priority,
      medium,
      source,
      sub_source,
      campaign,
      city,
      is_duplicate,
      is_converted,
      min_score,
      max_score,
      first_contacted_from,
      first_contacted_to,
      last_contacted_from,
      last_contacted_to,
      next_followup_from,
      next_followup_to,
      created_from,
      created_to,
      owner_id,
      assigned_agent,
      sortBy,
      sortOrder,
    } = req.query;

    // 🔴 Pagination validation
    if (page < 1) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Page number must be greater than 0",
        error: "invalid_page",
        data: null,
        validation: null,
      });
    }

    if (limit < 1 || limit > 100) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Limit must be between 1 and 100",
        error: "invalid_limit",
        data: null,
        validation: null,
      });
    }

    const offset = (page - 1) * limit;

    // ============================================================
    // 🔧 BASE QUERY BUILDER
    // ============================================================
    const buildBaseQuery = () => {
      let baseQuery = db
        .selectFrom("leads")
        .where("username", "=", accountUsername);

      // Agents only see leads assigned to them
      if (agentFilter) {
        baseQuery = baseQuery.where("assigned_agent", "=", agentFilter);
      }


      // 🔎 SEARCH
      if (search) {
        baseQuery = baseQuery.where((eb) =>
          eb.or([
            eb("username", "like", `%${search}%`),
            eb("source", "like", `%${search}%`),
            eb("first_name", "like", `%${search}%`),
            eb("last_name", "like", `%${search}%`),
            
            eb("assigned_agent", "like", `%${search}%`),
            eb("full_name", "like", `%${search}%`),
            eb("email", "like", `%${search}%`),
            eb("phone", "like", `%${search}%`),
            eb("country_code", "like", `%${search}%`),
            eb("term", "like", `%${search}%`),
            eb("city", "like", `%${search}%`),
            eb("status", "like", `%${search}%`),
             
          ])
        );
      }

      // 🎯 FILTERS
      if (tenant_id) baseQuery = baseQuery.where("tenant_id", "=", tenant_id);
      if (country_code)
        baseQuery = baseQuery.where("country_code", "=", country_code);
      if (status) baseQuery = baseQuery.where("status", "=", status);
      if (priority) baseQuery = baseQuery.where("priority", "=", priority);
      if (medium)     baseQuery = baseQuery.where("medium",     "=", medium);
      if (source)     baseQuery = baseQuery.where("source",     "=", source);
      if (sub_source) baseQuery = baseQuery.where("sub_source", "=", sub_source);
      if (campaign)   baseQuery = baseQuery.where("campaign",   "=", campaign);
      if (city)       baseQuery = baseQuery.where("city",       "=", city);

      // Only apply is_duplicate filter if it's a valid number (0 or 1), not "All" or other strings
      if (is_duplicate !== undefined && is_duplicate !== "All" && !isNaN(Number(is_duplicate))) {
        baseQuery = baseQuery.where("is_duplicate", "=", Number(is_duplicate));
      }

      // Only apply is_converted filter if it's a valid number (0 or 1), not "All" or other strings
      if (is_converted !== undefined && is_converted !== "All" && !isNaN(Number(is_converted))) {
        baseQuery = baseQuery.where("is_converted", "=", Number(is_converted));
      }

      // Lead score range
      if (min_score && !isNaN(Number(min_score)))
        baseQuery = baseQuery.where("lead_score", ">=", Number(min_score));
      if (max_score && !isNaN(Number(max_score)))
        baseQuery = baseQuery.where("lead_score", "<=", Number(max_score));

      if (owner_id)       baseQuery = baseQuery.where("owner_id",       "=", owner_id);
      if (assigned_agent) baseQuery = baseQuery.where("assigned_agent", "=", assigned_agent);

      // 📅 DATE RANGES
      if (first_contacted_from) { const d = new Date(first_contacted_from); if (!isNaN(d.getTime())) baseQuery = baseQuery.where("first_contacted_at", ">=", d); }
      if (first_contacted_to)   { const d = new Date(first_contacted_to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) baseQuery = baseQuery.where("first_contacted_at", "<=", d); }

      if (last_contacted_from) { const d = new Date(last_contacted_from); if (!isNaN(d.getTime())) baseQuery = baseQuery.where("last_contacted_at", ">=", d); }
      if (last_contacted_to)   { const d = new Date(last_contacted_to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) baseQuery = baseQuery.where("last_contacted_at", "<=", d); }

      if (next_followup_from) { const d = new Date(next_followup_from); if (!isNaN(d.getTime())) baseQuery = baseQuery.where("next_followup_at", ">=", d); }
      if (next_followup_to)   { const d = new Date(next_followup_to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) baseQuery = baseQuery.where("next_followup_at", "<=", d); }

      if (created_from) { const d = new Date(created_from); if (!isNaN(d.getTime())) baseQuery = baseQuery.where("created_at", ">=", d); }
      if (created_to)   { const d = new Date(created_to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) baseQuery = baseQuery.where("created_at", "<=", d); }

      return baseQuery;
    };

    // ============================================================
    // � DATA QUERY - DEDUPLICATE BY PHONE NUMBER
    // ============================================================
    const allowedSortColumns = [
      "id",
      "full_name",
      "first_name",
      "last_name",
      "email",
      "phone",
      "source",
      "priority",
      "medium",
      "status",
      "created_at",
      "updated_at",
      "first_contacted_at",
      "last_contacted_at",
      "lead_score",
      "assigned_agent",
    ];

    // 🔀 DETERMINE SORT COLUMN & ORDER
    const validSortBy = sortBy && allowedSortColumns.includes(sortBy) ? sortBy : "created_at";
    const validSortOrder = sortOrder && sortOrder.toLowerCase() === "asc" ? "asc" : "desc";

    // ============================================================
    // 🚀 SQL-LEVEL DEDUP + PAGINATION (was: load ALL rows + JS dedup/slice)
    // A window function keeps the newest lead per phone (empty/NULL phone =
    // its own group), so the DB does the work and we transfer one page only.
    // ============================================================
    const dedupedInner = () =>
      buildBaseQuery()
        .selectAll()
        .select(
          // CONVERT(phone) avoids a latin1/utf8mb4 collation clash in COALESCE
          sql<number>`ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(CONVERT(phone USING utf8mb4), ''), CONCAT('__id_', CAST(id AS CHAR))) ORDER BY created_at DESC, id DESC)`.as("rn")
        );

    // Page of deduplicated leads
    const pageRows: any[] = await (db as any)
      .selectFrom(dedupedInner().as("t"))
      .selectAll()
      .where("rn", "=", 1)
      .orderBy(validSortBy as any, validSortOrder)
      .limit(limit)
      .offset(offset)
      .execute();

    // Total deduplicated groups (drives pagination)
    const countRow: any = await (db as any)
      .selectFrom(dedupedInner().as("t"))
      .select((eb: any) => eb.fn.countAll().as("cnt"))
      .where("rn", "=", 1)
      .executeTakeFirst();
    const deduplicatedTotal = Number(countRow?.cnt ?? 0);

    // Overview KPIs over the deduplicated (filtered) set — one aggregate query
    const ov: any = await (db as any)
      .selectFrom(dedupedInner().as("t"))
      .where("rn", "=", 1)
      .select([
        sql<number>`COUNT(*)`.as("totalLeads"),
        sql<number>`SUM(CASE WHEN LOWER(status) = 'new' AND is_converted <> 1 THEN 1 ELSE 0 END)`.as("new"),
        sql<number>`SUM(CASE WHEN LOWER(status) = 'contacted' AND is_converted <> 1 THEN 1 ELSE 0 END)`.as("contacted"),
        sql<number>`SUM(CASE WHEN LOWER(status) = 'follow-up' AND is_converted <> 1 THEN 1 ELSE 0 END)`.as("followUp"),
        sql<number>`SUM(CASE WHEN LOWER(status) = 'qualified' AND is_converted <> 1 THEN 1 ELSE 0 END)`.as("qualified"),
        sql<number>`SUM(CASE WHEN LOWER(status) IN ('proposal / demo / visit', 'proposal sent') AND is_converted <> 1 THEN 1 ELSE 0 END)`.as("proposalDemo"),
        sql<number>`SUM(CASE WHEN LOWER(status) = 'won / converted' OR is_converted = 1 THEN 1 ELSE 0 END)`.as("converted"),
        sql<number>`SUM(CASE WHEN LOWER(status) = 'lost' THEN 1 ELSE 0 END)`.as("lost"),
        sql<number>`SUM(CASE WHEN next_followup_at IS NOT NULL AND next_followup_at < NOW() THEN 1 ELSE 0 END)`.as("overdue"),
      ])
      .executeTakeFirst();

    const overview = {
      totalLeads:   Number(ov?.totalLeads ?? 0),
      new:          Number(ov?.new ?? 0),
      contacted:    Number(ov?.contacted ?? 0),
      followUp:     Number(ov?.followUp ?? 0),
      qualified:    Number(ov?.qualified ?? 0),
      proposalDemo: Number(ov?.proposalDemo ?? 0),
      converted:    Number(ov?.converted ?? 0),
      lost:         Number(ov?.lost ?? 0),
      overdue:      Number(ov?.overdue ?? 0),
    };

    // ============================================================
    // 🔄 Duplicate sources for THIS page — one batched query, no writes
    // (was: N+1 queries + an UPDATE inside this read-only GET handler)
    // ============================================================
    const pagePhones = Array.from(new Set(pageRows.map((l) => l.phone).filter(Boolean)));
    const sourceRows: any[] = pagePhones.length
      ? await db
          .selectFrom("leads")
          .select(["phone", "source"])
          .where("username", "=", accountUsername)
          .where("phone", "in", pagePhones as string[])
          .execute()
      : [];

    const sourcesByPhone = new Map<string, Set<string>>();
    const countByPhone   = new Map<string, number>();
    for (const r of sourceRows) {
      if (!r.phone) continue;
      countByPhone.set(r.phone, (countByPhone.get(r.phone) ?? 0) + 1);
      if (r.source) {
        const set = sourcesByPhone.get(r.phone) ?? new Set<string>();
        set.add(r.source);
        sourcesByPhone.set(r.phone, set);
      }
    }

    const leadsWithSources = pageRows.map((row) => {
      const { rn, ...lead } = row; // strip the window helper column
      const dupCount = lead.phone ? (countByPhone.get(lead.phone) ?? 0) : 0;
      if (dupCount > 1) {
        return {
          ...lead,
          is_duplicate: 1,
          all_sources: Array.from(sourcesByPhone.get(lead.phone) ?? new Set([lead.source].filter(Boolean))),
        };
      }
      return { ...lead, all_sources: [lead.source].filter(Boolean) };
    });

    const totalPages = Math.ceil(deduplicatedTotal / limit) || 0;
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Leads fetched successfully",
      error: null,
      validation: null,
      data: {
        leads: leadsWithSources,
        overview,
        pagination: {
          page,
          limit,
          total: deduplicatedTotal,
          totalPages,
          hasNextPage,
          hasPreviousPage,
        },
        filters: {
          search: search || null,
          tenant_id: tenant_id || null,
          country_code: country_code || null,
          status: status || null,
          priority: priority || null,
          medium: medium || null,
          source: source || null,
          is_duplicate: is_duplicate || null,
          is_converted: is_converted || null,
          first_contacted_from: first_contacted_from || null,
          first_contacted_to: first_contacted_to || null,
          last_contacted_from: last_contacted_from || null,
          last_contacted_to: last_contacted_to || null,
          owner_id: owner_id || null,
          assigned_agent: assigned_agent || null,
          sortBy: validSortBy,
          sortOrder: validSortOrder,
        },
      },
    });
  } catch (error: any) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error",
      error: "server_error",
      data: null,
      validation: null,
    });
  }
};




export const getLeadById = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  try {
    const leadId = Number(req.params.id);

    // 🔴 Validate lead ID
    if (isNaN(leadId) || leadId <= 0) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Invalid lead id",
        error: "invalid_lead_id",
        data: null,
        validation: null,
      });
    }

    // 🔐 Ownership scope — resolve the account this user can read (agents
    // read under their parent's username, restricted to their assigned leads).
    // Without this, any authenticated user could read ANY lead by id (IDOR).
    const ownerUsername = req.user?.username;
    const userType      = (req.user as any)?.user_type as number | undefined;
    if (!ownerUsername) {
      return reply.status(401).send({
        status: 0, statuscode: 401, message: "Unauthorized user",
        error: "unauthorized", data: null, validation: null,
      });
    }

    let accountUsername: string = ownerUsername;
    let agentFilter: string | null = null;
    if (userType === 5) {
      const parentRow: any = await (db as any)
        .selectFrom("users")
        .select(["parent_username"])
        .where("username", "=", ownerUsername)
        .executeTakeFirst();
      accountUsername = parentRow?.parent_username ?? ownerUsername;
      agentFilter     = ownerUsername;
    }

    // ============================================================
    // 🔍 FETCH LEAD (explicit columns → tenant_id excluded)
    // ============================================================

    let leadQuery = db
      .selectFrom("leads")
      .select([
        "id",
        "username",
        "first_name",
        "last_name",
        "full_name",
        "email",
        "phone",
        "country_code",
        "city",
        "status",
        "lifecycle",
        "owner_id",
        "team_id",
        "priority",
        "source",
        "sub_source",
        "medium",
        "campaign",
        "term",
        "content",
        "landing_page",
        "lead_score",
        "first_contacted_at",
        "last_contacted_at",
        "last_activity_at",
        "next_followup_at",
        "is_duplicate",
        "is_converted",
        "is_archived",
        "created_by",
        "updated_by",
        "created_at",
        "updated_at",
      ])
      .where("id", "=", leadId)
      .where("username", "=", accountUsername); // 🔐 ownership isolation

    if (agentFilter) {
      leadQuery = leadQuery.where("assigned_agent", "=", agentFilter);
    }

    const lead = await leadQuery.executeTakeFirst();

    // ❌ Lead not found
    if (!lead) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Lead not found",
        error: "lead_not_found",
        data: null,
        validation: null,
      });
    }

    // ✅ Success (NO tenant_id in response)
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Lead fetched successfully",
      error: null,
      validation: null,
      data: lead,
    });
  } catch (error: any) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error",
      error: "server_error",
      data: null,
      validation: null,
    });
  }
};











