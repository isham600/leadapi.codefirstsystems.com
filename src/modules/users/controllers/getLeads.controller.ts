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

    // First, get all leads with the filters applied
    let allLeads = await buildBaseQuery()
      .selectAll()
      .orderBy(validSortBy as any, validSortOrder)
      .execute();

    // Deduplicate by phone number - keep only the most recent lead for each phone
    const uniqueLeadsMap = new Map();
    
    for (const lead of allLeads) {
      if (lead.phone) {
        const existing = uniqueLeadsMap.get(lead.phone);
        // Keep the lead with the most recent created_at timestamp
        if (!existing || new Date(lead.created_at) > new Date(existing.created_at)) {
          uniqueLeadsMap.set(lead.phone, lead);
        }
      } else {
        // If no phone number, keep the lead (use id as unique key)
        uniqueLeadsMap.set(`no_phone_${lead.id}`, lead);
      }
    }

    // Convert map back to array
    const deduplicatedLeads = Array.from(uniqueLeadsMap.values());
    
    // Calculate total AFTER deduplication
    const total = deduplicatedLeads.length;
    
    // Apply pagination to deduplicated results
    const leads = deduplicatedLeads.slice(offset, offset + limit);

    // ============================================================
    // 🔄 CHECK AND FETCH DUPLICATE SOURCES (BY PHONE NUMBER)
    // ============================================================
    const leadsWithSources = await Promise.all(
      leads.map(async (lead) => {
        // Check if this phone number exists in multiple leads
        if (lead.phone) {
          const duplicateLeads = await db
            .selectFrom("leads")
            .select(["id", "source", "created_at"])
            .where("username", "=", accountUsername)
            .where("phone", "=", lead.phone)
            .execute();

          // If more than one lead with same phone, it's a duplicate
          const isDuplicate = duplicateLeads.length > 1;

          if (isDuplicate) {
            // Get unique sources from all duplicate leads
            const allSources = Array.from(
              new Set(duplicateLeads.map((l) => l.source).filter(Boolean))
            );

            // Update is_duplicate flag for this lead if not already set
            if (lead.is_duplicate !== 1) {
              await db
                .updateTable("leads")
                .set({ is_duplicate: 1 })
                .where("id", "=", lead.id)
                .execute();
            }

            return {
              ...lead,
              is_duplicate: 1,
              all_sources: allSources,
            };
          }
        }

        return {
          ...lead,
          all_sources: [lead.source],
        };
      })
    );

    // Update total count to reflect deduplicated leads
    const deduplicatedTotal = deduplicatedLeads.length;
    const totalPages = Math.ceil(deduplicatedTotal / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // ============================================================
    // 📊 CALCULATE OVERVIEW STATISTICS
    // ============================================================
    const overview = {
      totalLeads: deduplicatedTotal,
      new: deduplicatedLeads.filter(lead => 
        lead.status?.toLowerCase() === 'new' && lead.is_converted !== 1
      ).length,
      contacted: deduplicatedLeads.filter(lead => 
        lead.status?.toLowerCase() === 'contacted' && lead.is_converted !== 1
      ).length,
      followUp: deduplicatedLeads.filter(lead => 
        lead.status?.toLowerCase() === 'follow-up' && lead.is_converted !== 1
      ).length,
      qualified: deduplicatedLeads.filter(lead => 
        lead.status?.toLowerCase() === 'qualified' && lead.is_converted !== 1
      ).length,
      proposalDemo: deduplicatedLeads.filter(lead => 
        (lead.status?.toLowerCase() === 'proposal / demo / visit' ||
        lead.status?.toLowerCase() === 'proposal sent') && lead.is_converted !== 1
      ).length,
      converted: deduplicatedLeads.filter(lead => 
        lead.status?.toLowerCase() === 'won / converted' ||
        lead.is_converted === 1
      ).length,
      lost: deduplicatedLeads.filter(lead => 
        lead.status?.toLowerCase() === 'lost'
      ).length,
      overdue: deduplicatedLeads.filter(lead => {
        if (!lead.next_followup_at) return false;
        const followupDate = new Date(lead.next_followup_at);
        const now = new Date();
        return followupDate < now;
      }).length,
    };

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

    // 🔐 tenant_id comes ONLY from JWT (verifyJwt middleware)
    const tenantId = (req.user as any)?.tenant_id;

    // if (!tenantId) {
    //   return reply.status(401).send({
    //     status: 0,
    //     statuscode: 401,
    //     message: "Unauthorized",
    //     error: "tenant_missing",
    //     data: null,
    //     validation: null,
    //   });
    // }

    // ============================================================
    // 🔍 FETCH LEAD (explicit columns → tenant_id excluded)
    // ============================================================
    
    const lead = await db
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
      // .where("tenant_id", "=", tenantId) // 🔐 tenant isolation
      .executeTakeFirst();

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











