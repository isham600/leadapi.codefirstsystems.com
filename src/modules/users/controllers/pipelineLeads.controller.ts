import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

// Status aliases: frontend stage name → all matching DB values
const STATUS_ALIASES: Record<string, string[]> = {
  "New":                     ["New", "NEW", "new"],
  "Contacted":               ["Contacted", "CONTACTED", "contacted"],
  "Follow-Up":               ["Follow-Up", "Follow Up", "FOLLOW-UP", "follow-up"],
  "Qualified":               ["Qualified", "QUALIFIED", "qualified"],
  "Proposal / Demo / Visit": ["Proposal / Demo / Visit", "Proposal", "Demo", "Visit", "PROPOSAL"],
  "Won / Converted":         ["Won / Converted", "Won", "Converted", "WON", "WON / CONVERTED", "won", "converted"],
  "Lost":                    ["Lost", "LOST", "lost"],
};

export const getPipelineLeads = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string; status?: string } }>,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;
    const userType = (req as any).user?.user_type as number | undefined;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

    // ── Agent hierarchy ────────────────────────────────────────
    let accountUsername: string = username;
    let agentFilter:     string | null = null;

    if (userType === 5) {
      const parentRow: any = await (db as any)
        .selectFrom("users")
        .select(["parent_username"])
        .where("username", "=", username)
        .executeTakeFirst();
      accountUsername = parentRow?.parent_username ?? username;
      agentFilter     = username;
    }

    const page      = parseInt(req.query.page   || "1");
    const limit     = parseInt(req.query.limit  || "20");
    const offset    = (page - 1) * limit;
    const rawStatus = req.query.status?.trim() || null;
    const statusFilter: string[] | null = rawStatus && STATUS_ALIASES[rawStatus]
      ? STATUS_ALIASES[rawStatus]
      : null;

    const WON_STATUSES  = ["Won", "Converted", "Won / Converted", "WON / CONVERTED"];
    const LOST_STATUSES = ["Lost", "LOST"];

    // Helper: apply agent/username scope (no status filter — used for overview stats)
    const applyScope = (q: any) => {
      q = q.where("username", "=", accountUsername);
      if (agentFilter) {
        q = q.where("assigned_agent", "=", agentFilter);
      } else {
        q = q.where("is_duplicate", "=", 0);
      }
      return q;
    };

    // Helper: scope + optional status filter (used for paginated leads query)
    const applyScopeWithStatus = (q: any) => {
      q = applyScope(q);
      if (statusFilter) q = q.where("status", "in", statusFilter);
      return q;
    };

    // Get total count for this status (or all if no status filter)
    const totalCountResult = await applyScopeWithStatus(
      db.selectFrom("leads").select(db.fn.count("id").as("total"))
    ).executeTakeFirst();

    const totalCount = Number(totalCountResult?.total || 0);
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore    = page < totalPages;

    // Overview stats — always global (ignore status filter)
    const overviewStats = await applyScope(
      db.selectFrom("leads").select([db.fn.count("id").as("totalLeads"), db.fn.sum("lead_value").as("totalValue")])
    ).executeTakeFirst();

    const wonLeadsResult = await applyScope(
      db.selectFrom("leads").select([db.fn.count("id").as("wonCount"), db.fn.sum("lead_value").as("wonValue")])
    ).where("status", "in", WON_STATUSES).executeTakeFirst();

    const pipelineLeadsResult = await applyScope(
      db.selectFrom("leads").select([db.fn.sum("lead_value").as("pipelineValue")])
    ).where("status", "not in", [...WON_STATUSES, ...LOST_STATUSES]).executeTakeFirst();

    const totalLeadsCount = Number(overviewStats?.totalLeads || 0);
    const wonLeadsCount   = Number(wonLeadsResult?.wonCount  || 0);
    const pipelineValue   = Number(pipelineLeadsResult?.pipelineValue || 0);
    const wonValue        = Number(wonLeadsResult?.wonValue  || 0);

    // Get leads with pagination — scoped by status if provided
    const leads = await applyScopeWithStatus(
      db.selectFrom("leads").selectAll()
    ).orderBy("id", "desc").limit(limit).offset(offset).execute();

    // ── Merge duplicate leads by phone number ────────────────────────────────
    // Group all rows by normalized phone. Combine sources, fill nulls from sibling rows.
    type LeadRow = typeof leads[number];
    const phoneGroups = new Map<string, LeadRow[]>();
    for (const lead of leads) {
      const key = lead.phone?.trim() || `__nophone_${lead.id}`;
      if (!phoneGroups.has(key)) phoneGroups.set(key, []);
      phoneGroups.get(key)!.push(lead);
    }

    // Pick first non-null value for a field across a group (sorted desc by id = newest first)
    const pick = (rows: LeadRow[], field: keyof LeadRow) =>
      rows.reduce((acc: any, r: any) => (acc != null && acc !== "" ? acc : r[field]), null as any);

    const mergedLeads = Array.from(phoneGroups.values()).map((rows) => {
      const primary = rows[0]; // newest row (is_duplicate=0 sorted first when admin view)
      const sources = [...new Set(rows.map((r) => r.source).filter(Boolean))];
      return {
        id:                 primary.id,
        fullname:           pick(rows, "full_name") || "",
        priority:           pick(rows, "priority")  || "Medium",
        email:              pick(rows, "email")      || "",
        number:             primary.phone            || "",
        sources,                                                // all channels this lead came from
        source:             sources.join(", "),                 // legacy single-source field
        overview:           `${pick(rows, "status") || "New"} lead from ${sources.join(" + ") || "Unknown"}`,
        status:             pick(rows, "status")     || "New",
        value:              rows.reduce((sum, r) => sum + (r.lead_value ? Number(r.lead_value) : 0), 0),
        expectedCloseDate:  pick(rows, "close_date") ? new Date(pick(rows, "close_date") as any).toISOString().split("T")[0] : null,
        city:               pick(rows, "city")       || "",
        assigned_agent:     pick(rows, "assigned_agent") || null,
        is_duplicate:       rows.some((r) => r.is_duplicate === 1),
        duplicate_count:    rows.length,
        created_at:         primary.created_at,
        updated_at:         primary.updated_at,
      };
    });

    const transformedLeads = mergedLeads;

    console.log("Sample lead data:", transformedLeads[0]); // Debug log

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Pipeline leads fetched successfully",
      data: transformedLeads,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasMore
      },
      overview: {
        totalLeads: totalLeadsCount,
        pipelineValue: pipelineValue,
        wonValue: wonValue,
        wonCount: wonLeadsCount
      },
      error: null,
      validation: null,
    });
  } catch (error) {
    console.error("Error fetching pipeline leads:", error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch pipeline leads",
      data: null,
      error: null,
      validation: null,
    });
  }
};

// ── GET /pipelineLeads/focus ──────────────────────────────────────────────────
// Returns focus deals computed server-side across ALL leads (not just loaded page).
// Criteria (any signal qualifies):
//   1. Close date overdue (past today)
//   2. Close date within next 7 days
//   3. Priority = High
//   4. Priority = Medium AND value >= 5000
//   5. Late stage (Qualified / Proposal) AND value >= 5000
// Sort: overdue first → closing soonest → highest value
export const getFocusDeals = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;
    const userType = (req as any).user?.user_type as number | undefined;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

    let accountUsername: string = username;
    let agentFilter: string | null = null;
    if (userType === 5) {
      const parentRow: any = await (db as any)
        .selectFrom("users").select(["parent_username"])
        .where("username", "=", username).executeTakeFirst();
      accountUsername = parentRow?.parent_username ?? username;
      agentFilter     = username;
    }

    const WON_STATUSES  = ["Won", "Converted", "Won / Converted", "WON / CONVERTED", "won", "converted"];
    const LOST_STATUSES = ["Lost", "LOST", "lost"];
    const LATE_STATUSES = [
      "Qualified", "QUALIFIED",
      "Proposal / Demo / Visit", "Proposal", "Demo", "Visit", "PROPOSAL",
    ];
    const HIGH_PRIORITY   = ["High", "HIGH", "high"];
    const MEDIUM_PRIORITY = ["Medium", "MEDIUM", "medium"];
    const HIGH_VALUE      = 5000;

    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const in7Days  = new Date(today); in7Days.setDate(today.getDate() + 7);

    // Fetch all open leads for this user (no pagination — focus needs full scope)
    let q = (db as any).selectFrom("leads").selectAll()
      .where("username", "=", accountUsername)
      .where("status", "not in", [...WON_STATUSES, ...LOST_STATUSES]);

    if (agentFilter) {
      q = q.where("assigned_agent", "=", agentFilter);
    } else {
      q = q.where("is_duplicate", "=", 0);
    }

    const allOpen: any[] = await q.execute();

    // Score and filter
    type FocusResult = {
      id: number; fullname: string; email: string; number: string;
      source: string; status: string; value: number;
      expectedCloseDate: string | null; priority: string | null;
      reason: string; overdue: boolean; daysLeft: number | null;
    };

    const results: FocusResult[] = [];

    for (const lead of allOpen) {
      const value    = Number(lead.lead_value ?? 0);
      const priority = (lead.priority ?? "").trim();
      const status   = (lead.status   ?? "").trim();

      let daysLeft: number | null = null;
      let overdue = false;
      if (lead.close_date) {
        const d = new Date(lead.close_date); d.setHours(0, 0, 0, 0);
        daysLeft = Math.floor((d.getTime() - today.getTime()) / 86400000);
        overdue  = daysLeft < 0;
      }

      const closingSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
      const isHigh      = HIGH_PRIORITY.includes(priority);
      const isMedium    = MEDIUM_PRIORITY.includes(priority);
      const isLate      = LATE_STATUSES.some(s => s.toLowerCase() === status.toLowerCase());

      const include =
        overdue ||
        closingSoon ||
        isHigh ||
        (isMedium && value >= HIGH_VALUE) ||
        (isLate   && value >= HIGH_VALUE);

      if (!include) continue;

      const reason =
        overdue                        ? "Overdue"          :
        closingSoon && daysLeft === 0  ? "Closes today"     :
        closingSoon                    ? `${daysLeft}d left` :
        isHigh                         ? "High priority"    :
        isLate && value >= HIGH_VALUE  ? "Late stage"       : "High value";

      results.push({
        id:                 lead.id,
        fullname:           lead.full_name   || "",
        email:              lead.email       || "",
        number:             lead.phone       || "",
        source:             lead.source      || "",
        status:             lead.status      || "",
        value,
        expectedCloseDate:  lead.close_date  ? new Date(lead.close_date).toISOString().split("T")[0] : null,
        priority:           lead.priority    || null,
        reason,
        overdue,
        daysLeft,
      });
    }

    // Sort: overdue → closing soonest → highest value
    results.sort((a, b) => {
      if (a.overdue !== b.overdue)         return a.overdue ? -1 : 1;
      if (a.daysLeft !== null && b.daysLeft !== null) return a.daysLeft - b.daysLeft;
      if (a.daysLeft !== null)             return -1;
      if (b.daysLeft !== null)             return  1;
      return b.value - a.value;
    });

    return reply.send({
      status: 1, statuscode: 200, message: "Focus deals fetched",
      data: results.slice(0, 20),
      total: results.length,
    });
  } catch (error) {
    console.error("Error fetching focus deals:", error);
    return reply.status(500).send({ status: 0, statuscode: 500, message: "Failed to fetch focus deals" });
  }
};

export const updateLead = async (
  req: FastifyRequest<{ Params: { id: string }; Body: { status?: string; value?: number; expectedCloseDate?: string; source?: string } }>,
  reply: FastifyReply
) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log("Updating lead:", id, "with data:", updateData); // Debug log

    // Convert frontend field names to database field names
    const dbUpdateData: any = {};
    
    if (updateData.status !== undefined) {
      dbUpdateData.status = updateData.status;
    }
    if (updateData.value !== undefined) {
      dbUpdateData.lead_value = updateData.value;
    }
    if (updateData.expectedCloseDate !== undefined) {
      dbUpdateData.close_date = updateData.expectedCloseDate;
    }
    if (updateData.source !== undefined) {
      dbUpdateData.source = updateData.source;
    }

    console.log("Database update data:", dbUpdateData); // Debug log

    // Update the lead in database
    const result = await db
      .updateTable("leads")
      .set(dbUpdateData)
      .where("id", "=", parseInt(id))
      .execute();

    console.log("Update result:", result); // Debug log

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Lead updated successfully",
      data: { id: parseInt(id), ...updateData },
      error: null,
      validation: null,
    });
  } catch (error) {
    console.error("Error updating lead:", error);
    
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to update lead",
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
      validation: null,
    });
  }
};