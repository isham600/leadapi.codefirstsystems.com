import { FastifyRequest, FastifyReply } from "fastify";
import { sql } from "kysely";
import { db } from "../../../models/db.js";
import { getDateRange, PeriodType } from "../utils/date_range_filter.js";

// Query types for getLeadsDashboard
export interface GetLeadsDashboardQuery {
  period?: PeriodType;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
  search?: string;
}

/**
 * ============================================================
 * 🔐 AGENT / ADMIN DASHBOARD (ROLE-AWARE)
 * ============================================================
 *
 * Rules:
 * - user_type === 5 (Agent)        → only their own dashboard
 * - user_type === 2 (Admin)        → aggregated over their child agents
 * - user_type === 1 (Super Admin)  → aggregated over ALL agents
 * - Other roles                    → cannot access this dashboard
 *
 * NOTE:
 * - No agent identifier is accepted from the frontend.
 * - All filtering is driven only by the authenticated user
 *   (username + user_type) coming from the verified JWT.
 */
 
export const agentdashboard = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { period = "last_30_days", from, to, agent: requestedAgent } = req.query as any;

    const authUser: any = (req as any).user;
    const username: string | undefined = authUser?.username;
    const userType: number | undefined = authUser?.user_type;

    if (!username || !userType) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        data: null,
      });
    }

    // 🔐 Allowed roles
    if (![1, 2, 5].includes(userType)) {
      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: "Forbidden - dashboard not available for this role",
        data: null,
      });
    }

    // ============================================================
    // 📅 Date Range
    // ============================================================
    const { startDate, endDate } = getDateRange(period, from, to);

    // ============================================================
    // 👥 Resolve Agent Usernames (supports role-based context switch)
    // If `requestedAgent` query param is provided and requester is admin/superadmin,
    // validate ownership and scope the view to that single agent.
    // ============================================================
    let agentUsernames: string[] = [];
    // accountUsername: the parent/master account whose leads table is used.
    // null means no username scoping (super admin across all accounts).
    let accountUsername: string | null = null;

    // If an agent identifier is provided in query, attempt to resolve it
    if (requestedAgent && (userType === 1 || userType === 2)) {
      // requestedAgent may be numeric id or username/email
      let found: any = null;
      const asNumber = Number(requestedAgent);
      if (!Number.isNaN(asNumber) && asNumber > 0) {
        found = await db.selectFrom("users").selectAll().where("id", "=", asNumber).where("user_type", "=", 5).executeTakeFirst();
      }
      if (!found) {
        // try by username or email
        found = await db
          .selectFrom("users")
          .selectAll()
          .where((eb) => eb.or([eb("username", "=", requestedAgent), eb("email", "=", requestedAgent)]))
          .where("user_type", "=", 5)
          .executeTakeFirst();
      }

      if (!found) {
        return reply.status(404).send({
          status: 0,
          statuscode: 404,
          message: "Requested agent not found",
          data: null,
        });
      }

      // If requester is admin (userType === 2), ensure the agent belongs to this admin
      if (userType === 2 && found.parent_username !== username) {
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: "Forbidden - agent does not belong to this admin",
          data: null,
        });
      }

      // scope to the single agent username
      agentUsernames = [found.username];
      // Admin requesting agent data: leads are under the admin's account
      if (userType === 2) accountUsername = username;
    } else {
      if (userType === 5) {
        // Agent → self; leads are under parent account
        const parentRow: any = await db
          .selectFrom("users")
          .select(["parent_username"])
          .where("username", "=", username)
          .executeTakeFirst();
        agentUsernames  = [username];
        accountUsername = parentRow?.parent_username ?? username;
      } else if (userType === 2) {
        // Admin → child agents; leads are under this admin's account
        const childAgents = await db
          .selectFrom("users")
          .select(["username"])
          .where("parent_username", "=", username)
          .where("user_type", "=", 5)
          .execute();

        agentUsernames  = childAgents.map((a) => a.username).filter(Boolean);
        accountUsername = username;
      } else if (userType === 1) {
        // Super Admin → all agents; no username scoping
        const allAgents = await db
          .selectFrom("users")
          .select(["username"])
          .where("user_type", "=", 5)
          .execute();

        agentUsernames = allAgents.map((a) => a.username).filter(Boolean);
        // accountUsername stays null — no cross-account username filter
      }
    }

    // ============================================================
    // 🚫 No Agents Found
    // ============================================================
    if (agentUsernames.length === 0) {
      return reply.status(200).send({
        status: 1,
        statuscode: 200,
        message: "agent dashboard data fetched successfully",
        data: {
          date_range: { period, from: startDate, to: endDate },
          total_leads: 0,
          status_wise_leads: {
            new: 0,
            contacted: 0,
            follow_up: 0,
            qualified: 0,
            negotiation:0,
            proposal_sent: 0,
            converted: 0,
            lost: 0,
          },
          win_rate: 0,
          leads_by_source: [],
          latest_5_leads: [],
          monthly_revenue: 0,
          pipeline_value: 0,
          avg_deal_size: 0,
        },
        error: null,
        validation: null,
      });
    }

    // ============================================================
    // 🔹 BASE QUERY (USED EVERYWHERE)
    // Agents see ALL their assigned leads (including duplicates).
    // Username scoping prevents cross-account data leakage.
    // ============================================================
    let baseLeadsQuery = db
      .selectFrom("leads")
      .where("assigned_agent", "in", agentUsernames)
      .where("created_at", ">=", startDate)
      .where("created_at", "<=", endDate);

    if (accountUsername) {
      baseLeadsQuery = baseLeadsQuery.where("username", "=", accountUsername);
    }

    // ============================================================
    // 📊 TOTAL LEADS
    // ============================================================
    const totalLeads = await baseLeadsQuery
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();

    const totalLeadsCount = Number(totalLeads?.count || 0);

    // ============================================================
    // 📊 STATUS-WISE LEADS (DONUT)
    // ============================================================
    const statusRaw = await baseLeadsQuery
      .select([
        sql`UPPER(COALESCE(status, 'NEW'))`.as("status"),
        db.fn.count("id").as("count"),
      ])
      .groupBy(sql`UPPER(COALESCE(status, 'NEW'))`)
      .execute();

    const statusMap: Record<string, number> = {
      NEW: 0,
      CONTACTED: 0,
      "FOLLOW-UP": 0,
      QUALIFIED: 0,
      PROPOSAL_SENT: 0,
      NEGOTIATION: 0,
      CONVERTED: 0,
      LOST: 0,
    };

    statusRaw.forEach((r: any) => {
      const u = (r.status ?? "").toUpperCase().trim();
      let key = u;
      if (u === "FOLLOW UP" || u === "FOLLOWUP") key = "FOLLOW-UP";
      else if (u === "WON / CONVERTED" || u === "WON/CONVERTED" || u === "WON") key = "CONVERTED";
      else if (u.startsWith("PROPOSAL") || u === "PROPOSAL / DEMO / VISIT") key = "PROPOSAL_SENT";
      statusMap[key] = (statusMap[key] ?? 0) + Number(r.count);
    });

    // ============================================================
    // 🏆 WIN RATE
    // ============================================================
    const winRate =
      totalLeadsCount > 0
        ? Math.round((statusMap["CONVERTED"] / totalLeadsCount) * 100)
        : 0;

    // ============================================================
    // 📊 LEADS BY SOURCE (BAR CHART)
    // ============================================================
    const sourceRaw = await baseLeadsQuery
      .select([
        sql`COALESCE(source, 'Unknown')`.as("source"),
        db.fn.count("id").as("count"),
      ])
      .groupBy(sql`COALESCE(source, 'Unknown')`)
      .orderBy("count", "desc")
      .execute();

    const leads_by_source = sourceRaw.map((r: any) => ({
      source: r.source,
      count: Number(r.count),
    }));

    // ============================================================
    // 🕒 LATEST 5 LEADS
    // ============================================================
    const latest_5_leads = await baseLeadsQuery
      .select([
        "id",
        "full_name",
        "email",
        "phone",
        "status",
        "source",
        "assigned_agent",
        "created_at",
      ])
      .orderBy("created_at", "desc")
      .limit(5)
      .execute();

    // ============================================================
    // 📋 TODAY'S TASKS (from lead_followups)
    // ============================================================
    const todayTasksRaw = await db
      .selectFrom("lead_followups")
      .select(["id", "lead_id", "lead_name", "scheduled_at", "notes", "status"])
      .where("login_username", "in", agentUsernames)
      .where(sql`DATE(scheduled_at) = CURDATE()`)
      .orderBy("scheduled_at", "asc")
      .limit(10)
      .execute();

    const today_tasks = (todayTasksRaw as any[]).map((t) => ({
      id: t.id,
      lead_id: t.lead_id,
      lead_name: t.lead_name || "—",
      scheduled_at: t.scheduled_at,
      notes: t.notes || "",
      status: t.status || "pending",
    }));

    // ============================================================
    // 📊 DAILY PERFORMANCE (from lead_activities — today only)
    // ============================================================
    const dailyActivityRaw = await db
      .selectFrom("lead_activities")
      .select([
        sql`UPPER(COALESCE(activity_type, 'OTHER'))`.as("type"),
        db.fn.count("id").as("count"),
      ])
      .where("login_username", "in", agentUsernames)
      .where(sql`DATE(created_at) = CURDATE()`)
      .groupBy(sql`UPPER(COALESCE(activity_type, 'OTHER'))`)
      .execute();

    const activityMap: Record<string, number> = {};
    (dailyActivityRaw as any[]).forEach((r) => {
      activityMap[r.type] = Number(r.count);
    });

    const daily_performance = {
      calls: activityMap["CALL"] || 0,
      emails: activityMap["EMAIL"] || 0,
      whatsapp: activityMap["WHATSAPP"] || 0,
      followups: activityMap["FOLLOWUP"] || 0,
      total: Object.values(activityMap).reduce((a, b) => a + b, 0),
    };

    // ============================================================
    // ⏱️ RESPONSE TIME STATS (avg minutes + SLA compliance)
    // ============================================================
    const responseStatsRaw = await db
      .selectFrom("leads")
      .select([
        sql<number>`AVG(TIMESTAMPDIFF(MINUTE, created_at, first_contacted_at))`.as("avg_minutes"),
        sql<number>`SUM(CASE WHEN TIMESTAMPDIFF(MINUTE, created_at, first_contacted_at) <= 60 THEN 1 ELSE 0 END)`.as("within_sla"),
        db.fn.count("id").as("total_contacted"),
      ])
      .where("is_duplicate", "=", 0)
      .where("assigned_agent", "in", agentUsernames)
      .where("first_contacted_at", "is not", null)
      .executeTakeFirst() as any;

    const avgResponseMinutes = Math.round(Number(responseStatsRaw?.avg_minutes || 0));
    const avgResponseFormatted = avgResponseMinutes >= 60
      ? `${Math.floor(avgResponseMinutes / 60)}h ${avgResponseMinutes % 60}m`
      : `${avgResponseMinutes}m`;
    const withinSla = Number(responseStatsRaw?.within_sla || 0);
    const totalContacted = Number(responseStatsRaw?.total_contacted || 0);
    const slaCompliance = totalContacted > 0
      ? Math.round((withinSla / totalContacted) * 1000) / 10
      : 0;

    // ============================================================
    // ⚠️ OVERDUE TASKS (lead_followups past due, still pending)
    // ============================================================
    const overdueTasksResult = await db
      .selectFrom("lead_followups")
      .select(db.fn.count("id").as("count"))
      .where("login_username", "in", agentUsernames)
      .where("status", "=", "pending")
      .where("scheduled_at", "<", new Date())
      .where(sql`DATE(scheduled_at) != CURDATE()`)
      .executeTakeFirst();
    const overdue_tasks = Number(overdueTasksResult?.count || 0);

    // ============================================================
    // ✅ FINAL RESPONSE
    // ============================================================
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Agent dashboard data fetched successfully",
      data: {
        date_range: {
          period,
          from: startDate,
          to: endDate,
        },

        total_leads: totalLeadsCount,

        status_wise_leads: {
          new: statusMap["NEW"],
          contacted: statusMap["CONTACTED"],
          follow_up: statusMap["FOLLOW-UP"],
          qualified: statusMap["QUALIFIED"],
          proposal_sent: statusMap["PROPOSAL SENT"],
          negotiation: statusMap["NEGOTIATION"],
          converted: statusMap["CONVERTED"],
          lost: statusMap["LOST"],
        },

        win_rate: winRate,
        leads_by_source,
        latest_5_leads,
        today_tasks,
        daily_performance,
        response_stats: {
          avg_response: avgResponseFormatted,
          avg_response_minutes: avgResponseMinutes,
          sla_compliance: slaCompliance,
          overdue_tasks,
        },

        // placeholders (future use)
        monthly_revenue: 0,
        pipeline_value: 0,
        avg_deal_size: 0,
      },
      error: null,
      validation: null,
    });
  } catch (error: any) {
    console.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch agent dashboard data",
      data: null,
      error: error.message,
      validation: null,
    });
  }
};


 
 
export const getadmindashboard = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { period = "last_7_days", from, to } = req.query as any;

    /* -------------------- 🔐 Auth from token -------------------- */
    const authUser: any = (req as any).user;
    const username: string | undefined = authUser?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        data: null,
      });
    }

    /* -------------------- 📅 Date range -------------------- */
    const { startDate, endDate } = getDateRange(period, from, to);

    /* ============================================================
       📊 TOTAL LEADS (for same username)
       exclude duplicates
    ============================================================ */
    const totalLeads = await db
      .selectFrom("leads")
      .select(db.fn.count("id").as("count"))
      .where("is_duplicate", "=", 0)
      .where("username", "=", username)
      .where("created_at", ">=", startDate)
      .where("created_at", "<=", endDate)
      .executeTakeFirst();

    const totalLeadsCount = Number(totalLeads?.count || 0);

    /* ============================================================
       📊 UNASSIGNED LEADS (NULL or 'unassigned')
    ============================================================ */
    const unassignedLeads = await db
      .selectFrom("leads")
      .select(db.fn.count("id").as("count"))
      .where("is_duplicate", "=", 0)
      .where("username", "=", username)
      .where((eb) =>
        eb.or([
          eb("assigned_agent", "is", null),
          eb("assigned_agent", "=", "unassigned"),
        ])
      )
      .where("created_at", ">=", startDate)
      .where("created_at", "<=", endDate)
      .executeTakeFirst();

    const unassignedLeadsCount = Number(unassignedLeads?.count || 0);

    /* ============================================================
       📊 STATUS WISE LEADS
    ============================================================ */
    // Status counts — filtered by the same date range as total_leads
    const statusCountsRaw = await db
      .selectFrom("leads")
      .select([
        sql`UPPER(status)`.as("status"),
        db.fn.count("id").as("count"),
      ])
      .where("is_duplicate", "=", 0)
      .where("username", "=", username)
      .where("created_at", ">=", startDate)
      .where("created_at", "<=", endDate)
      .groupBy(sql`UPPER(status)`)
      .execute();

    const statusWiseCounts: Record<string, number> = {
      NEW: 0,
      CONTACTED: 0,
      "FOLLOW UP": 0,
      QUALIFIED: 0,
      "PROPOSAL SENT": 0,
      NEGOTIATION: 0,
      CONVERTED: 0,
      LOST: 0,
    };

    // Normalize DB status values to the canonical keys above
    const normalizeStatus = (s: string): string => {
      const u = (s ?? "").toUpperCase().trim();
      if (u === "FOLLOW-UP" || u === "FOLLOW UP" || u === "FOLLOWUP") return "FOLLOW UP";
      if (u === "WON / CONVERTED" || u === "WON/CONVERTED" || u === "CONVERTED" || u === "WON") return "CONVERTED";
      if (u.startsWith("PROPOSAL") || u === "PROPOSAL SENT" || u === "PROPOSAL / DEMO / VISIT" || u === "DEMO") return "PROPOSAL SENT";
      return u;
    };

    statusCountsRaw.forEach((row: any) => {
      const key = normalizeStatus(row.status);
      statusWiseCounts[key] = (statusWiseCounts[key] ?? 0) + Number(row.count);
    });

    /* -------------------- 🏆 WIN RATE -------------------- */
    const converted = statusWiseCounts["CONVERTED"];
    const winRate =
      totalLeadsCount > 0
        ? Math.round((converted / totalLeadsCount) * 100)
        : 0;

    /* ============================================================
       📅 DUE TODAY (next_followup_at = today, not converted/lost)
    ============================================================ */
    const dueTodayResult = await db
      .selectFrom("leads")
      .select(db.fn.count("id").as("count"))
      .where("is_duplicate", "=", 0)
      .where("username", "=", username)
      .where(sql`DATE(next_followup_at) = CURDATE()`)
      .where(sql`UPPER(COALESCE(status, '')) NOT IN ('CONVERTED', 'LOST', 'WON / CONVERTED')`)
      .executeTakeFirst();
    const dueTodayCount = Number(dueTodayResult?.count || 0);

    /* ============================================================
       ⚠️ OVERDUE (next_followup_at < NOW(), not converted/lost)
    ============================================================ */
    const overdueResult = await db
      .selectFrom("leads")
      .select(db.fn.count("id").as("count"))
      .where("is_duplicate", "=", 0)
      .where("username", "=", username)
      .where("next_followup_at", "is not", null)
      .where("next_followup_at", "<", new Date())
      .where(sql`DATE(next_followup_at) != CURDATE()`)
      .where(sql`UPPER(COALESCE(status, '')) NOT IN ('CONVERTED', 'LOST', 'WON / CONVERTED')`)
      .executeTakeFirst();
    const overdueCount = Number(overdueResult?.count || 0);

    /* ============================================================
       💰 REVENUE & PIPELINE METRICS (from lead_value field)
    ============================================================ */
    const monthlyRevenueResult = await db
      .selectFrom("leads")
      .select(db.fn.sum("lead_value").as("total"))
      .where("is_duplicate", "=", 0)
      .where("username", "=", username)
      .where("created_at", ">=", startDate)
      .where("created_at", "<=", endDate)
      .where(sql`UPPER(COALESCE(status, '')) IN ('CONVERTED', 'WON / CONVERTED')`)
      .executeTakeFirst();
    const monthlyRevenue = Number(monthlyRevenueResult?.total || 0);

    // Pipeline value = ALL active leads regardless of period (current snapshot)
    const pipelineValueResult = await db
      .selectFrom("leads")
      .select(db.fn.sum("lead_value").as("total"))
      .where("is_duplicate", "=", 0)
      .where("username", "=", username)
      .where("lead_value", "is not", null)
      .where("lead_value", ">", 0)
      .where(sql`UPPER(COALESCE(status, '')) NOT IN ('CONVERTED', 'WON / CONVERTED', 'LOST')`)
      .executeTakeFirst();
    const pipelineValue = Number(pipelineValueResult?.total || 0);

    const avgDealSizeResult = await db
      .selectFrom("leads")
      .select(db.fn.avg("lead_value").as("avg"))
      .where("is_duplicate", "=", 0)
      .where("username", "=", username)
      .where("created_at", ">=", startDate)
      .where("created_at", "<=", endDate)
      .where(sql`UPPER(COALESCE(status, '')) IN ('CONVERTED', 'WON / CONVERTED')`)
      .where("lead_value", "is not", null)
      .executeTakeFirst();
    const avgDealSize = Number(avgDealSizeResult?.avg || 0);

    /* ============================================================
       ⏱️ RESPONSE TIME BY WEEKDAY (avg minutes from created to first_contacted)
    ============================================================ */
    const responseTimeRaw = await db
      .selectFrom("leads")
      .select([
        sql<number>`WEEKDAY(created_at)`.as("day_index"),
        sql<number>`AVG(TIMESTAMPDIFF(MINUTE, created_at, first_contacted_at))`.as("avg_minutes"),
      ])
      .where("is_duplicate", "=", 0)
      .where("username", "=", username)
      .where("created_at", ">=", startDate)
      .where("created_at", "<=", endDate)
      .where("first_contacted_at", "is not", null)
      .groupBy(sql`WEEKDAY(created_at)`)
      .execute();

    const responseTimeByWeekday = [0, 0, 0, 0, 0, 0, 0];
    (responseTimeRaw as any[]).forEach((r) => {
      const i = Number(r.day_index);
      if (i >= 0 && i <= 6) {
        responseTimeByWeekday[i] = Math.round(Number(r.avg_minutes) * 10) / 10;
      }
    });

    /* ============================================================
       🤖 AUTOMATION STATS (from chatbot_summary table)
    ============================================================ */
    const activeWorkflowsResult = await db
      .selectFrom("chatbot_summary")
      .select(db.fn.count("id").as("count"))
      .where("username", "=", username)
      .where(sql`LOWER(COALESCE(status, '')) = 'active'`)
      .executeTakeFirst();
    const activeWorkflows = Number(activeWorkflowsResult?.count || 0);

    const totalRunsTodayResult = await db
      .selectFrom("chatbot_summary")
      .select(db.fn.sum("runs").as("total"))
      .where("username", "=", username)
      .where(sql`DATE(last_run) = CURDATE()`)
      .executeTakeFirst();
    const triggersToday = Number(totalRunsTodayResult?.total || 0);

    const totalChatbotsResult = await db
      .selectFrom("chatbot_summary")
      .select(db.fn.count("id").as("count"))
      .where("username", "=", username)
      .executeTakeFirst();
    const totalChatbots = Number(totalChatbotsResult?.count || 0);

    const draftWorkflowsResult = await (db as any)
      .selectFrom("chatbot_summary")
      .select(db.fn.count("id").as("count"))
      .where("username", "=", username)
      .where(sql`LOWER(COALESCE(status, '')) = 'draft'`)
      .executeTakeFirst();
    const draftWorkflows = Number(draftWorkflowsResult?.count || 0);

    /* -------------------- ✅ RESPONSE -------------------- */
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Admin dashboard data fetched successfully",
      data: {
        date_range: {
          period,
          from: startDate,
          to: endDate,
        },

        total_leads: totalLeadsCount,
        unassigned_leads: unassignedLeadsCount,
        due_today: dueTodayCount,
        overdue: overdueCount,

        status_wise_leads: {
          new: statusWiseCounts["NEW"],
          contacted: statusWiseCounts["CONTACTED"],
          follow_up: statusWiseCounts["FOLLOW UP"],
          qualified: statusWiseCounts["QUALIFIED"],
          proposal_sent: statusWiseCounts["PROPOSAL SENT"],
          negotiation: statusWiseCounts["NEGOTIATION"],
          converted: statusWiseCounts["CONVERTED"],
          lost: statusWiseCounts["LOST"],
        },

        win_rate: winRate,
        monthly_revenue: monthlyRevenue,
        pipeline_value: pipelineValue,
        avg_deal_size: avgDealSize,
        response_time_by_weekday: responseTimeByWeekday,

        automation: {
          active_workflows: activeWorkflows,
          triggers_today: triggersToday,
          total_chatbots: totalChatbots,
          draft_workflows: draftWorkflows,
        },
      },
      error: null,
      validation: null,
    });
  } catch (error) {
    console.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch admin dashboard data",
      data: null,
      error: (error as any).message,
      validation: null,
    });
  }
};

// Weekday order: Mon=0 .. Sun=6 (MySQL WEEKDAY)
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * ============================================================
 * 📋 GET LEADS DASHBOARD API
 * ============================================================
 * - userType 2 (Admin): filter by leads.username = token username
 * - userType 5 (Agent): filter by assigned_agent = token username
 * - userType 1 (Super Admin): all leads
 * Returns: latest 5 leads, channel counts, weekday-by-source, received/qualified, paginated list, search
 */
export const getLeadsDashboard = async (
  req: FastifyRequest<{ Querystring: GetLeadsDashboardQuery }>,
  reply: FastifyReply
) => {
  try {
    const {
      period = "last_7_days",
      from,
      to,
      page = "1",
      limit = "20",
      search,
    } = req.query;

    const authUser: any = (req as any).user;
    const username: string | undefined = authUser?.username;
    const userType: number | undefined = authUser?.user_type;

    if (!username || userType === undefined) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        data: null,
      });
    }

    // Agents (5) cannot access leads dashboard
    if (userType === 5) {
      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: "Forbidden - leads dashboard is not available for agents",
        data: null,
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let periodTyped: PeriodType = period as PeriodType;
    if (
      period !== "last_24_hours" &&
      period !== "today" &&
      period !== "yesterday" &&
      period !== "daily" &&
      period !== "last_7_days" &&
      period !== "last_30_days" &&
      period !== "monthly" &&
      period !== "custom"
    ) {
      periodTyped = "last_7_days";
    }
    const { startDate, endDate } = getDateRange(periodTyped, from, to);

    // Base filter: date range + role-based
    const applyBaseFilter = (qb: any) => {
      let q = qb
        .where("is_duplicate", "=", 0)
        .where("created_at", ">=", startDate)
        .where("created_at", "<=", endDate);
      if (userType === 5) {
        q = q.where("assigned_agent", "=", username);
      } else if (userType === 2) {
        // Admin: see only their own leads
        q = q.where("username", "=", username);
      } else if (userType === 1) {
        // Super Admin: see only leads they created (their own account)
        q = q.where("username", "=", username);
      } else {
        // Other (3, 4): see only their own leads
        q = q.where("username", "=", username);
      }
      return q;
    };

    const applySearch = (qb: any) => {
      if (!search?.trim()) return qb;
      return qb.where((eb: any) =>
        eb.or([
          eb("first_name", "like", `%${search.trim()}%`),
          eb("last_name", "like", `%${search.trim()}%`),
          eb("full_name", "like", `%${search.trim()}%`),
          eb("email", "like", `%${search.trim()}%`),
          eb("phone", "like", `%${search.trim()}%`),
          eb("city", "like", `%${search.trim()}%`),
          eb("source", "like", `%${search.trim()}%`),
          eb("sub_source", "like", `%${search.trim()}%`),
        ])
      );
    };

    // 0) Active deals: Proposal Sent / Negotiation / Qualified — top 6 by lead_value desc
    const activeDealsRaw = await applyBaseFilter(db.selectFrom("leads"))
      .select([
        "id",
        "full_name",
        "status",
        "lead_value",
        "assigned_agent",
        "created_at",
        "updated_at",
      ])
      .where(sql`UPPER(COALESCE(status, '')) IN ('PROPOSAL SENT', 'NEGOTIATION', 'QUALIFIED', 'FOLLOW UP', 'FOLLOW-UP', 'CONTACTED')`)
      .orderBy("lead_value", "desc")
      .orderBy("updated_at", "desc")
      .limit(6)
      .execute();
    const active_deals = (activeDealsRaw as any[]).map((d) => ({
      id: d.id,
      name: d.full_name || "—",
      stage: d.status || "—",
      value: Number(d.lead_value || 0),
      owner: d.assigned_agent || "Unassigned",
      days_in_stage: d.updated_at
        ? Math.floor((Date.now() - new Date(d.updated_at).getTime()) / 86400000)
        : 0,
    }));

    // 1) Latest 5 leads (fetch more to account for duplicates, then deduplicate)
    let latestQuery = applyBaseFilter(db.selectFrom("leads"));
    latestQuery = applySearch(latestQuery);
    const rawLatest5 = await latestQuery
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(20)  // Fetch more to account for duplicates
      .execute();
    // remove duplicates by email/phone and keep only 5
    const seenLatest = new Set<string>();
    const latest5: any[] = [];
    for (const l of rawLatest5 as any[]) {
      if (latest5.length >= 5) break;  // Stop once we have 5 unique leads
      const key = `${l.email || ""}|${l.phone || ""}`;
      if (key && seenLatest.has(key)) continue;
      seenLatest.add(key);
      latest5.push(l);
    }

    // 2) Count by source and sub_source (channel)
    const channelCounts = await applyBaseFilter(db.selectFrom("leads"))
      .select([
        "source",
        "sub_source",
        db.fn.count("id").as("count"),
      ])
      .groupBy(["source", "sub_source"])
      .execute();

    const leads_by_channel = (channelCounts as any[]).map((r) => ({
      source: r.source ?? "unknown",
      sub_source: r.sub_source ?? null,
      count: Number(r.count),
    }));

    // 3) Count by weekday and source (Mon..Sun, per source)
    // Ensure all 7 days are returned; use 0 for days with no leads
    const weekdaySourceRaw = await applyBaseFilter(db.selectFrom("leads"))
      .select([
        sql<number>`WEEKDAY(created_at)`.as("day_index"),
        "source",
        db.fn.count("id").as("count"),
      ])
      .groupBy([sql`WEEKDAY(created_at)`, "source"])
      .execute();

    const rawMap = new Map<string, number>();
    const sourcesSet = new Set<string>();
    (weekdaySourceRaw as any[]).forEach((r) => {
      const dayIndex = Number(r.day_index);
      const source = (r.source ?? "unknown") as string;
      sourcesSet.add(source);
      rawMap.set(`${dayIndex}-${source}`, Number(r.count));
    });

    const allSources = Array.from(sourcesSet).sort();
    const leads_by_weekday_by_source: {
      weekday: string;
      day_index: number;
      source: string;
      count: number;
    }[] = [];
    for (let dayIndex = 0; dayIndex <= 6; dayIndex++) {
      for (const source of allSources) {
        const count = rawMap.get(`${dayIndex}-${source}`) ?? 0;
        leads_by_weekday_by_source.push({
          weekday: WEEKDAY_LABELS[dayIndex] ?? "Unknown",
          day_index: dayIndex,
          source,
          count,
        });
      }
      // If no sources at all, still add one row per day with source "unknown" and count 0
      if (allSources.length === 0) {
        leads_by_weekday_by_source.push({
          weekday: WEEKDAY_LABELS[dayIndex] ?? "Unknown",
          day_index: dayIndex,
          source: "unknown",
          count: 0,
        });
      }
    }

    // 3b) Lead activity heatmap: weekday vs 2-hour bins
    const heatmapRaw = await applyBaseFilter(db.selectFrom("leads"))
      .select([
        sql<number>`WEEKDAY(created_at)` .as("day_index"),
        sql<number>`FLOOR(HOUR(created_at)/2)` .as("hour_bin"),
        db.fn.count("id").as("count"),
      ])
      .groupBy([sql`WEEKDAY(created_at)`, sql`FLOOR(HOUR(created_at)/2)`])
      .execute();

    const heatmapMatrix: number[][] = Array.from({ length: 7 }, () =>
      Array(12).fill(0)
    );
    (heatmapRaw as any[]).forEach((r) => {
      const d = Number(r.day_index);
      const h = Number(r.hour_bin);
      if (d >= 0 && d <= 6 && h >= 0 && h < 12) {
        heatmapMatrix[d][h] = Number(r.count);
      }
    });
    const heatmap_series = heatmapMatrix.map((row, idx) => ({
      name: WEEKDAY_LABELS[idx] ?? "Unknown",
      data: row,
    }));

    // 4) Received vs Qualified
    const receivedResult = await applyBaseFilter(db.selectFrom("leads"))
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();
    const qualifiedResult = await applyBaseFilter(db.selectFrom("leads"))
      .where(sql`UPPER(COALESCE(status, '')) = 'QUALIFIED'`)
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();

    const received_count = Number(receivedResult?.count ?? 0);
    const qualified_count = Number(qualifiedResult?.count ?? 0);

    // Received and qualified by weekday (all 7 days, 0 if none)
    const receivedByWeekdayRaw = await applyBaseFilter(db.selectFrom("leads"))
      .select([
        sql<number>`WEEKDAY(created_at)`.as("day_index"),
        db.fn.count("id").as("count"),
      ])
      .groupBy(sql`WEEKDAY(created_at)`)
      .execute();
    const qualifiedByWeekdayRaw = await applyBaseFilter(db.selectFrom("leads"))
      .where(sql`UPPER(COALESCE(status, '')) = 'QUALIFIED'`)
      .select([
        sql<number>`WEEKDAY(created_at)`.as("day_index"),
        db.fn.count("id").as("count"),
      ])
      .groupBy(sql`WEEKDAY(created_at)`)
      .execute();

    const received_by_weekday = [0, 0, 0, 0, 0, 0, 0];
    const qualified_by_weekday = [0, 0, 0, 0, 0, 0, 0];
    (receivedByWeekdayRaw as any[]).forEach((r) => {
      const i = Number(r.day_index);
      if (i >= 0 && i <= 6) received_by_weekday[i] = Number(r.count);
    });
    (qualifiedByWeekdayRaw as any[]).forEach((r) => {
      const i = Number(r.day_index);
      if (i >= 0 && i <= 6) qualified_by_weekday[i] = Number(r.count);
    });

    // 5) Paginated leads list with search (ensure duplicates are removed)
    let listQuery = applyBaseFilter(db.selectFrom("leads"));
    listQuery = applySearch(listQuery);

    // count distinct by email+phone to avoid duplicates in total
    const totalResult = await listQuery
      .select(
        sql`COUNT(DISTINCT CONCAT(COALESCE(email, ''), '|', COALESCE(phone, '')))`.as("total")
      )
      .executeTakeFirst();
    const total = Number(totalResult?.total ?? 0);

    const leadsList = await listQuery
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(limitNum)
      .offset(offset)
      .execute();

    // dedupe results in JS in case SQL distinct not enough
    const seen = new Set<string>();
    const uniqueLeads: any[] = [];
    for (const l of leadsList as any[]) {
      const key = `${l.email || ""}|${l.phone || ""}`;
      if (key && seen.has(key)) continue;
      seen.add(key);
      uniqueLeads.push(l);
    }

    const totalPages = Math.ceil(total / limitNum);

    // 6) STATUS-WISE LEADS for Sales Dashboard
    const statusCountsRaw = await applyBaseFilter(db.selectFrom("leads"))
      .select([
        sql`UPPER(COALESCE(status, 'NEW'))`.as("status"),
        db.fn.count("id").as("count"),
      ])
      .groupBy(sql`UPPER(COALESCE(status, 'NEW'))`)
      .execute();

    const statusWiseLead: Record<string, number> = {
      NEW: 0,
      CONTACTED: 0,
      QUALIFIED: 0,
      "PROPOSAL SENT": 0,
      NEGOTIATION: 0,
      CONVERTED: 0,
      LOST: 0,
      "FOLLOW UP": 0,
    };

    (statusCountsRaw as any[]).forEach((row: any) => {
      const u = (row.status ?? "").toUpperCase().trim();
      let key = u;
      if (u === "FOLLOW-UP" || u === "FOLLOWUP") key = "FOLLOW UP";
      else if (u === "WON / CONVERTED" || u === "WON/CONVERTED" || u === "WON") key = "CONVERTED";
      else if (u.startsWith("PROPOSAL") || u === "PROPOSAL / DEMO / VISIT") key = "PROPOSAL SENT";
      statusWiseLead[key] = (statusWiseLead[key] ?? 0) + Number(row.count);
    });

    // Calculate additional metrics
    const totalLeads = received_count;
    const convertedLeads = statusWiseLead["CONVERTED"];
    const winRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;
    
    // Count unassigned leads
    const unassignedResult = await applyBaseFilter(db.selectFrom("leads"))
      .where((eb: any) => 
        eb.or([
          eb("assigned_agent", "is", null),
          eb("assigned_agent", "=", ""),
        ])
      )
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();
    const unassignedLeads = Number(unassignedResult?.count ?? 0);

    // Get top 10 agents by conversion count
    const topAgentsRaw = await applyBaseFilter(db.selectFrom("leads"))
      .where("is_converted", "=", 1)
      .where((eb: any) => 
        eb.or([
          eb("assigned_agent", "is not", null),
          eb("assigned_agent", "!=", ""),
        ])
      )
      .select([
        "assigned_agent",
        db.fn.count("id").as("converted_count"),
      ])
      .groupBy("assigned_agent")
      .orderBy(db.fn.count("id"), "desc")
      .limit(10)
      .execute();

    const topAgents = (topAgentsRaw as any[]).map((agent) => ({
      agent_name: agent.assigned_agent || "Unknown",
      converted_leads: Number(agent.converted_count),
    }));

    // Revenue & pipeline metrics from lead_value field
    const monthlyRevenueRes = await applyBaseFilter(db.selectFrom("leads"))
      .select(db.fn.sum("lead_value").as("total"))
      .where(sql`UPPER(COALESCE(status, '')) IN ('CONVERTED', 'WON / CONVERTED')`)
      .executeTakeFirst();
    const monthlyRevenue = Number(monthlyRevenueRes?.total || 0);

    const pipelineValueRes = await applyBaseFilter(db.selectFrom("leads"))
      .select(db.fn.sum("lead_value").as("total"))
      .where(sql`UPPER(COALESCE(status, '')) NOT IN ('CONVERTED', 'WON / CONVERTED', 'LOST')`)
      .executeTakeFirst();
    const pipelineValue = Number(pipelineValueRes?.total || 0);

    const avgDealSizeRes = await applyBaseFilter(db.selectFrom("leads"))
      .select(db.fn.avg("lead_value").as("avg"))
      .where(sql`UPPER(COALESCE(status, '')) IN ('CONVERTED', 'WON / CONVERTED')`)
      .where("lead_value", "is not", null)
      .executeTakeFirst();
    const avgDealSize = Number(avgDealSizeRes?.avg || 0);

    // Response time by weekday (avg minutes from created_at to first_contacted_at)
    const responseTimeRaw = await applyBaseFilter(db.selectFrom("leads"))
      .select([
        sql<number>`WEEKDAY(created_at)`.as("day_index"),
        sql<number>`AVG(TIMESTAMPDIFF(MINUTE, created_at, first_contacted_at))`.as("avg_minutes"),
      ])
      .where("first_contacted_at", "is not", null)
      .groupBy(sql`WEEKDAY(created_at)`)
      .execute();

    const responseTimeByWeekday = [0, 0, 0, 0, 0, 0, 0];
    (responseTimeRaw as any[]).forEach((r) => {
      const i = Number(r.day_index);
      if (i >= 0 && i <= 6) {
        responseTimeByWeekday[i] = Math.round(Number(r.avg_minutes) * 10) / 10;
      }
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Leads dashboard data fetched successfully",
      data: {
        date_range: {
          period: periodTyped,
          from: startDate,
          to: endDate,
        },
        total_leads: totalLeads,
        unassigned_leads: unassignedLeads,
        win_rate: winRate,
        monthly_revenue: monthlyRevenue,
        pipeline_value: pipelineValue,
        avg_deal_size: avgDealSize,
        active_deals,
        latest_5_leads: latest5,
        leads_by_channel,
        leads_by_weekday_by_source,
        received_count,
        qualified_count,
        received_by_weekday,
        qualified_by_weekday,
        heatmap: {
          series: heatmap_series,
          // categories are defined client side (hours array)
        },
        status_wise_leads: {
          new: statusWiseLead["NEW"],
          contacted: statusWiseLead["CONTACTED"],
          qualified: statusWiseLead["QUALIFIED"],
          proposal_sent: statusWiseLead["PROPOSAL SENT"],
          negotiation: statusWiseLead["NEGOTIATION"],
          converted: statusWiseLead["CONVERTED"],
          lost: statusWiseLead["LOST"],
          follow_up: statusWiseLead["FOLLOW UP"],
        },
        response_time_by_weekday: responseTimeByWeekday,
        top_agents: topAgents,
        leads: uniqueLeads,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNextPage: pageNum < totalPages,
          hasPreviousPage: pageNum > 1,
        },
        filters: {
          search: search?.trim() || null,
          period: periodTyped,
          from: from || null,
          to: to || null,
        },
      },
      error: null,
      validation: null,
    });
  } catch (error) {
    console.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch leads dashboard data",
      data: null,
      error: (error as any).message,
      validation: null,
    });
  }
};

/**
 * ============================================================
 * 📊 AGENT MANAGEMENT DASHBOARD API
 * ============================================================
 *
 * Rules:
 * - user_type === 2 (Admin)        → only their child agents
 * - user_type === 1 (Super Admin)  → all agents
 * 
 * Returns:
 * - Total agents count
 * - Active agents count (status = 1)
 * - Inactive agents count (status = 0)
 * - Agent list with pagination including:
 *   - name, email, status, assigned_leads, qualified_leads, converted_leads, avg_lead_score
 */
export const getAgentManagementDashboard = async (
  req: FastifyRequest<{ Querystring: {
    period?: PeriodType;
    from?: string;
    to?: string;
    page?: string;
    limit?: string;
    search?: string;
  }}>,
  reply: FastifyReply
) => {
  try {
    const { period = "last_30_days", from, to, page = "1", limit = "10", search = "" } = req.query as any;

    const authUser: any = (req as any).user;
    const username: string | undefined = authUser?.username;
    const userType: number | undefined = authUser?.user_type;

    if (!username || !userType) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        data: null,
      });
    }

    // Agents (5) cannot access agent management dashboard
    if (userType === 5) {
      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: "Forbidden - agents cannot access agent management dashboard",
        data: null,
      });
    }

    // ============================================================
    // 📅 Date Range (validate period & support custom from/to)
    // ============================================================
    let periodTyped: PeriodType = period as PeriodType;
    if (
      period !== "last_24_hours" &&
      period !== "today" &&
      period !== "yesterday" &&
      period !== "daily" &&
      period !== "last_7_days" &&
      period !== "last_30_days" &&
      period !== "monthly" &&
      period !== "custom"
    ) {
      periodTyped = "last_7_days";
    }
    const { startDate, endDate } = getDateRange(periodTyped, from, to);

    // ============================================================
    // 👥 Build Base Query for Agents
    // ============================================================
    let agentsBaseQuery = db.selectFrom("users").where("user_type", "=", 5);

    if (userType !== 1) {
      // Admin (2), Reseller (3), User (4) → only their child agents
      agentsBaseQuery = agentsBaseQuery.where("parent_username", "=", username);
    }
    // Super Admin (1) → all agents (no additional filter)

    // ============================================================
    // 🔍 Apply Search Filter
    // ============================================================
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      agentsBaseQuery = agentsBaseQuery.where((eb) =>
        eb.or([
          eb("firstname", "like", searchTerm),
          eb("lastname", "like", searchTerm),
          eb("email", "like", searchTerm),
          eb("username", "like", searchTerm),
        ])
      );
    }

    // ============================================================
    // 📅 Apply Date Range to agent queries (created_at)
    // ============================================================
    agentsBaseQuery = agentsBaseQuery
      .where("created_at", ">=", startDate)
      .where("created_at", "<=", endDate);

    // ============================================================
    // 📊 COUNT: Total Agents
    // ============================================================
    const totalAgentsResult = await agentsBaseQuery
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();
    const totalAgents = Number(totalAgentsResult?.count || 0);

    // ============================================================
    // 📊 COUNT: Active Agents (status = 1)
    // ============================================================
    const activeAgentsResult = await agentsBaseQuery
      .where("is_active", "=", 1)
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();
    const activeAgents = Number(activeAgentsResult?.count || 0);

    // ============================================================
    // 📊 COUNT: Inactive Agents (status = 0)
    // ============================================================
    const inactiveAgentsResult = await agentsBaseQuery
      .where("is_active", "=", 0)
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();
    const inactiveAgents = Number(inactiveAgentsResult?.count || 0);

    // ============================================================
    // 📄 PAGINATED AGENT LIST with Lead Stats
    // ============================================================
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Math.min(100, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Fetch paginated agents
    const agentRecords = await agentsBaseQuery
      .select([
        "id",
        "username",
        "firstname",
        "lastname",
        "email",
        "is_active",
        "created_at",
      ])
      .orderBy("created_at", "desc")
      .limit(limitNum)
      .offset(offset)
      .execute();

    // ============================================================
    // 📊 Fetch Lead Stats for Each Agent
    // ============================================================
    const enrichedAgents = await Promise.all(
      agentRecords.map(async (agent) => {
        // Base query for this agent's leads within date range
        const agentLeadsBaseQuery = db
          .selectFrom("leads")
          .where("is_duplicate", "=", 0)
          .where("assigned_agent", "=", agent.username)
          .where("created_at", ">=", startDate)
          .where("created_at", "<=", endDate);

        // Count total assigned leads
        const totalLeadsResult = await agentLeadsBaseQuery
          .select(db.fn.count("id").as("count"))
          .executeTakeFirst();
        const totalAssignedLeads = Number(totalLeadsResult?.count || 0);

        // Count qualified leads
        const qualifiedLeadsResult = await agentLeadsBaseQuery
          .where("status", "=", "QUALIFIED")
          .select(db.fn.count("id").as("count"))
          .executeTakeFirst();
        const qualifiedLeads = Number(qualifiedLeadsResult?.count || 0);

        // Count converted leads
        const convertedLeadsResult = await agentLeadsBaseQuery
          .where("status", "=", "CONVERTED")
          .select(db.fn.count("id").as("count"))
          .executeTakeFirst();
        const convertedLeads = Number(convertedLeadsResult?.count || 0);

        // Calculate average lead score
        const avgScoreResult = await agentLeadsBaseQuery
          .select(db.fn.avg("lead_score").as("avg_score"))
          .executeTakeFirst();
        const avgLeadScore = avgScoreResult?.avg_score ? Number(avgScoreResult.avg_score).toFixed(2) : 0;

        return {
          id: agent.id,
          username: agent.username,
          name: [agent.firstname, agent.lastname].filter(Boolean).join(" ") || agent.username,
          email: agent.email || "—",
          status: agent.is_active === 1 ? "active" : "inactive",
          status_code: agent.is_active,
          assigned_leads: totalAssignedLeads,
          qualified_leads: qualifiedLeads,
          converted_leads: convertedLeads,
          avg_lead_score: Number(avgLeadScore),
          created_at: agent.created_at,
        };
      })
    );

    // ============================================================
    // ✅ FINAL RESPONSE
    // ============================================================
    const totalPages = Math.ceil(totalAgents / limitNum);

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Agent management dashboard data fetched successfully",
      data: {
        summary: {
          total_agents: totalAgents,
          active_agents: activeAgents,
          inactive_agents: inactiveAgents,
        },
        agents: enrichedAgents,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalAgents,
          totalPages,
          hasNextPage: pageNum < totalPages,
          hasPreviousPage: pageNum > 1,
        },
        filters: {
          period,
          from: from || null,
          to: to || null,
          search: search?.trim() || null,
        },
        date_range: {
          startDate,
          endDate,
        },
      },
      error: null,
      validation: null,
    });
  } catch (error: any) {
    console.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch agent management dashboard data",
      data: null,
      error: error.message,
      validation: null,
    });
  }
};