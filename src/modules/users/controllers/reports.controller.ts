// ============================================================
// 📊 REPORTS CONTROLLER - SOURCE ATTRIBUTION & CONVERSION RATES
// ============================================================

import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { sql } from "kysely";

export interface SourceAttributionQuery {
  search?: string;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
}

export interface SourceData {
  source: string;
  total_leads: number;
  converted_leads: number;
  conversion_rate: string;
}

/**
 * ============================================================
 * 🔹 GET SOURCE ATTRIBUTION REPORT
 * ============================================================
 * 
 * Logic:
 * 1. Extract username from JWT token
 * 2. Find all leads where username matches the token username
 * 3. Group leads by source
 * 4. For each source, count:
 *    - Total leads
 *    - Converted leads (is_converted = 1)
 *    - Conversion rate (converted / total * 100)
 * 5. Order by total leads DESC
 * 
 * Response Format:
 * {
 *   "status": 1,
 *   "statuscode": 200,
 *   "message": "...",
 *   "data": {
 *     "summary": {
 *       "total_leads": 1234,
 *       "total_converted": 567,
 *       "overall_conversion_rate": "45.97%"
 *     },
 *     "by_source": [
 *       {
 *         "source": "google",
 *         "total_leads": 410,
 *         "converted_leads": 65,
 *         "conversion_rate": "15.85%"
 *       },
 *       ...
 *     ],
 *     "filters": {
 *       "search": null,
 *       "from": null,
 *       "to": null
 *     }
 *   }
 * }
 */
export const getSourceAttributionReport = async (
  req: FastifyRequest<{ Querystring: SourceAttributionQuery }>,
  reply: FastifyReply
) => {
  try {
    // ============================================================
    // 🔐 AUTH VERIFICATION
    // ============================================================
    const authUser: any = (req as any).user;
    const username: string | undefined = authUser?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized user",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    // ============================================================
    // 🔧 EXTRACT QUERY PARAMS
    // ============================================================
    const { search, from, to, page: qpage, limit: qlimit } = req.query;

    const page = parseInt(qpage || "1", 10);
    const limit = parseInt(qlimit || "10", 10);

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
    // 🔧 BUILD BASE QUERY
    // ============================================================
    let baseQuery = db
      .selectFrom("leads")
      .where("username", "=", username);

    // 🔎 SEARCH FILTER (by full_name, email, phone, etc.)
    if (search) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb("full_name", "like", `%${search}%`),
          eb("source", "like", `%${search}%`),
          eb("last_name", "like", `%${search}%`),
          eb("email", "like", `%${search}%`),
          eb("phone", "like", `%${search}%`),
        ])
      );
    }

    // 📅 DATE RANGE FILTER (created_at)
    if (from) {
      const startDate = new Date(from);
      if (!isNaN(startDate.getTime())) {
        baseQuery = baseQuery.where("created_at", ">=", startDate);
      }
    }

    if (to) {
      const endDate = new Date(to);
      if (!isNaN(endDate.getTime())) {
        endDate.setHours(23, 59, 59, 999);
        baseQuery = baseQuery.where("created_at", "<=", endDate);
      }
    }

    // ============================================================
    // 📊 CALCULATE OVERALL SUMMARY
    // ============================================================
    const summaryQuery = baseQuery
      .select((eb) => [
        eb.fn.countAll().as("total"),
        eb.fn
          .sum(
            eb.case()
              .when("is_converted", "=", 1)
              .then(1)
              .else(0)
              .end()
          )
          .as("converted"),
      ]);

    const summaryResult = await summaryQuery.executeTakeFirst();
    const totalLeads = Number(summaryResult?.total || 0);
    const totalConverted = Number(summaryResult?.converted || 0);
    const overallConversionRate =
      totalLeads > 0
        ? ((totalConverted / totalLeads) * 100).toFixed(2)
        : "0.00";

    // ============================================================
    // 📊 GROUP BY SOURCE AND COUNT
    // ============================================================
    const sourceDataQuery = baseQuery
      .select((eb) => [
        "source",
        eb.fn.countAll().as("total"),
        eb.fn
          .sum(
            eb.case()
              .when("is_converted", "=", 1)
              .then(1)
              .else(0)
              .end()
          )
          .as("converted"),
      ])
      .groupBy("source")
      .orderBy("total", "desc");

    // Execute full grouped results (distinct sources) then paginate in-memory
    const allSourceResults = await sourceDataQuery.execute();
    const totalSources = allSourceResults.length;
    const pagedResults = allSourceResults.slice(offset, offset + limit);

    // ============================================================
    // 🔄 TRANSFORM DATA & CALCULATE CONVERSION RATES
    // ============================================================
    const bySource: SourceData[] = pagedResults.map((row: any) => {
      const total = Number(row.total || 0);
      const converted = Number(row.converted || 0);
      const conversionRate =
        total > 0 ? ((converted / total) * 100).toFixed(2) : "0.00";

      return {
        source: row.source || "Unknown",
        total_leads: total,
        converted_leads: converted,
        conversion_rate: `${conversionRate}%`,
      };
    });

    // ============================================================
    // ✅ SEND RESPONSE
    // ============================================================
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Source attribution report fetched successfully",
      error: null,
      validation: null,
      data: {
        summary: {
          total_leads: totalLeads,
          total_converted: totalConverted,
          overall_conversion_rate: `${overallConversionRate}%`,
        },
        by_source: bySource,
        pagination: {
          page,
          limit,
          total: totalSources,
          totalPages: Math.max(1, Math.ceil(totalSources / limit)),
          hasNextPage: page * limit < totalSources,
          hasPreviousPage: page > 1,
        },
        filters: {
          search: search || null,
          from: from || null,
          to: to || null,
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

/**
 * ============================================================
 * 🔹 GET CONVERSION STATISTICS BY SOURCE
 * ============================================================
 * 
 * Advanced breakdown including:
 * - Lead stages distribution per source
 * - Status breakdown
 * - Average lead score by source
 */
export const getConversionStatsBySource = async (
  req: FastifyRequest<{ Querystring: SourceAttributionQuery }>,
  reply: FastifyReply
) => {
  try {
    // ============================================================
    // 🔐 AUTH VERIFICATION
    // ============================================================
    const authUser: any = (req as any).user;
    const username: string | undefined = authUser?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized user",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    // ============================================================
    // 🔧 EXTRACT QUERY PARAMS
    // ============================================================
    const { from, to } = req.query;

    // ============================================================
    // 🔧 BUILD BASE QUERY
    // ============================================================
    let baseQuery = db
      .selectFrom("leads")
      .where("username", "=", username);

    // 📅 DATE RANGE FILTER
    if (from) {
      const startDate = new Date(from);
      if (!isNaN(startDate.getTime())) {
        baseQuery = baseQuery.where("created_at", ">=", startDate);
      }
    }

    if (to) {
      const endDate = new Date(to);
      if (!isNaN(endDate.getTime())) {
        endDate.setHours(23, 59, 59, 999);
        baseQuery = baseQuery.where("created_at", "<=", endDate);
      }
    }

    // ============================================================
    // 📊 GET DETAILED STATS BY SOURCE AND STATUS
    // ============================================================
    const detailedStatsQuery = baseQuery
      .select((eb) => [
        "source",
        "status",
        "is_converted",
        eb.fn.countAll().as("count"),
        eb.fn.avg("lead_score").as("avg_lead_score"),
      ])
      .groupBy(["source", "status", "is_converted"])
      .orderBy("source", "asc");

    const detailedResults = await detailedStatsQuery.execute();

    // ============================================================
    // 🔄 STRUCTURE DETAILED DATA BY SOURCE
    // ============================================================
    const statsBySource: Record<
      string,
      {
        source: string;
        stages: Record<
          string,
          {
            stage: string;
            total: number;
            converted: number;
            not_converted: number;
            avg_lead_score: number;
          }
        >;
      }
    > = {};

    detailedResults.forEach((row: any) => {
      const source = row.source || "Unknown";
      const stage = row.status || "Unset";
      const isConverted = row.is_converted;
      const count = Number(row.count || 0);

      if (!statsBySource[source]) {
        statsBySource[source] = {
          source,
          stages: {},
        };
      }

      if (!statsBySource[source].stages[stage]) {
        statsBySource[source].stages[stage] = {
          stage,
          total: 0,
          converted: 0,
          not_converted: 0,
          avg_lead_score: 0,
        };
      }

      statsBySource[source].stages[stage].total += count;
      if (isConverted === 1) {
        statsBySource[source].stages[stage].converted += count;
      } else {
        statsBySource[source].stages[stage].not_converted += count;
      }
      statsBySource[source].stages[stage].avg_lead_score = parseFloat(
        (row.avg_lead_score || 0).toFixed(2)
      );
    });

    // ============================================================
    // ✅ SEND RESPONSE
    // ============================================================
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Conversion statistics by source fetched successfully",
      error: null,
      validation: null,
      data: Object.values(statsBySource),
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

/**
 * ============================================================
 * 🔹 GET PIPELINE HEALTH (LEADS BY STATUS)
 * ============================================================
 * 
 * Logic:
 * 1. Extract username from JWT token
 * 2. Filter leads where username matches token username
 * 3. Group and count leads by status
 * 4. Return status distribution
 * 
 * Response Format:
 * {
 *   "status": 1,
 *   "statuscode": 200,
 *   "message": "...",
 *   "data": {
 *     "stages": [
 *       { "status": "New", "count": 520 },
 *       { "status": "Contacted", "count": 380 },
 *       ...
 *     ]
 *   }
 * }
 */

 

export const getPipelineHealth = async (
  req: FastifyRequest<{ Querystring: SourceAttributionQuery }>,
  reply: FastifyReply
) => {
  try {
    // ============================================================
    // 🔐 AUTH
    // ============================================================
    const authUser: any = (req as any).user;
    const username = authUser?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized user",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    // ============================================================
    // 📥 QUERY PARAMS
    // ============================================================
    const {
      search,
      from,
      to,
      page = "1",
      limit = "10",
    } = req.query;

    const pageNo = Number(page);
    const pageSize = Number(limit);
    const offset = (pageNo - 1) * pageSize;

    // ============================================================
    // 🧱 BASE QUERY
    // ============================================================
    let baseQuery = db
      .selectFrom("leads")
      .where("username", "=", username);

    // ============================================================
    // 🔍 SEARCH (status)
    // ============================================================
    if (search) {
      baseQuery = baseQuery.where((eb) =>
        eb("status", "like", `%${search}%`)
      );
    }

    // ============================================================
    // 📅 DATE FILTER (created_at)
    // ============================================================
  //   baseQuery = baseQuery
  // .where("created_at", ">=", from)
  // .where("created_at", "<=", to);

    // ============================================================
    // 📊 TOTAL COUNT (for pagination)
    // ============================================================
    const totalResult = await baseQuery
      .select((eb) => eb.fn.countAll().as("total"))
      .executeTakeFirst();

    const totalRecords = Number(totalResult?.total || 0);

    // ============================================================
    // 📊 MAIN PIPELINE QUERY
    // ============================================================
    const pipelineResults = await baseQuery
      .select((eb) => [
        "status",
        eb.fn.countAll().as("count"),
      ])
      .groupBy("status")
      .orderBy("status", "asc")
      .limit(pageSize)
      .offset(offset)
      .execute();

    // ============================================================
    // 🔄 TRANSFORM
    // ============================================================
    const stages = pipelineResults.map((row: any) => ({
      status: row.status || "Unknown",
      count: Number(row.count || 0),
    }));

    // ============================================================
    // ✅ RESPONSE
    // ============================================================
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Pipeline health fetched successfully",
      error: null,
      validation: null,
      data: {
        stages,
        pagination: {
          page: pageNo,
          limit: pageSize,
          totalRecords,
          totalPages: Math.ceil(totalRecords / pageSize),
        },
      },
    });
  } catch (error) {
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
/**
 * ============================================================
 * 🔹 GET TEAM PRODUCTIVITY REPORT
 * ============================================================
 * 
 * Logic:
 * 1. Extract username from JWT token
 * 2. Filter leads where username matches token username
 * 3. Group by assigned_agent
 * 4. For each agent, count:
 *    - Total leads assigned
 *    - Leads closed (is_converted = 1)
 * 5. Support pagination
 * 
 * Response Format:
 * {
 *   "status": 1,
 *   "statuscode": 200,
 *   "message": "...",
 *   "data": {
 *     "agents": [
 *       {
 *         "agent_name": "John Doe",
 *         "leads_assigned": 120,
 *         "leads_closed": 36
 *       },
 *       ...
 *     ],
 *     "pagination": {
 *       "page": 1,
 *       "limit": 10,
 *       "total": 25,
 *       "totalPages": 3,
 *       "hasNextPage": true,
 *       "hasPreviousPage": false
 *     }
 *   }
 * }
 */





 
// export const getTeamProductivity = async (
//   req: FastifyRequest<{ Querystring: SourceAttributionQuery }>,
//   reply: FastifyReply
// ) => {
//   try {
//     // ============================================================
//     // 🔐 AUTH
//     // ============================================================
//     const authUser: any = (req as any).user;
//     const username: string | undefined = authUser?.username;

//     if (!username) {
//       return reply.status(401).send({
//         status: 0,
//         statuscode: 401,
//         message: "Unauthorized user",
//         error: "unauthorized",
//         data: null,
//         validation: null,
//       });
//     }

//     // ============================================================
//     // 🔧 QUERY PARAMS
//     // ============================================================
//     const { page: qpage, limit: qlimit } = req.query;

//     const page = Math.max(1, parseInt(qpage || "1", 10));
//     const limit = Math.min(100, Math.max(1, parseInt(qlimit || "10", 10)));
//     const offset = (page - 1) * limit;

//     // ============================================================
//     // 📊 TOTAL AGENTS (USERS TABLE SE)
//     // ============================================================
//     const totalAgentsResult = await db
//       .selectFrom("users")
//       .select(db.fn.count("id").as("count"))
//       .where("user_type", "=", 5) // agent
//       .where("parent_username", "=", username) // login admin ke agents
//       .executeTakeFirst();

//     const totalAgents = Number(totalAgentsResult?.count || 0);

//     // ============================================================
//     // 📊 AGENT + LEADS DATA
//     // ============================================================
//     const agentQuery = db
//       .selectFrom("users as u")
//       .leftJoin("leads as l", (join) =>
//         join
//           .onRef("u.username", "=", "l.assigned_agent")
//           .on("l.username", "=", username) // sirf login admin ki leads
//       )
//       .where("u.user_type", "=", 5)
//       .where("u.parent_username", "=", username)
//       .select((eb) => [
//         "u.username as agent_name",
//         eb.fn.count("l.id").as("leads_assigned"),
//         eb.fn
//           .sum(
//             eb
//               .case()
//               .when("l.is_converted", "=", 1)
//               .then(1)
//               .else(0)
//               .end()
//           )
//           .as("leads_closed"),
//       ])
//       .groupBy("u.username")
//       .orderBy("leads_assigned", "desc")
//       .limit(limit)
//       .offset(offset);

//     const agentResults = await agentQuery.execute();

//     // ============================================================
//     // 🔄 RESPONSE TRANSFORM
//     // ============================================================
//     const agents = agentResults.map((row: any) => ({
//       agent_name: row.agent_name,
//       leads_assigned: Number(row.leads_assigned || 0),
//       leads_closed: Number(row.leads_closed || 0),
//     }));

//     // ============================================================
//     // ✅ RESPONSE
//     // ============================================================
//     return reply.status(200).send({
//       status: 1,
//       statuscode: 200,
//       message: "Team productivity report fetched successfully",
//       error: null,
//       validation: null,
//       data: {
//         agents,
//         pagination: {
//           page,
//           limit,
//           total: totalAgents,
//           totalPages: Math.max(1, Math.ceil(totalAgents / limit)),
//           hasNextPage: page * limit < totalAgents,
//           hasPreviousPage: page > 1,
//         },
//       },
//     });
//   } catch (error: any) {
//     req.log.error(error);
//     return reply.status(500).send({
//       status: 0,
//       statuscode: 500,
//       message: "Server error",
//       error: "server_error",
//       data: null,
//       validation: null,
//     });
//   }
// };




export const getTeamProductivity = async (
  req: FastifyRequest<{ Querystring: SourceAttributionQuery }>,
  reply: FastifyReply
) => {
  try {
    // ============================================================
    // 🔐 AUTH
    // ============================================================
    const authUser: any = (req as any).user;
    const username: string | undefined = authUser?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized user",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    // ============================================================
    // 🔧 QUERY PARAMS
    // ============================================================
    const { page: qpage, limit: qlimit, search } = req.query as any; // 🔍 search

    const page = Math.max(1, parseInt(qpage || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(qlimit || "10", 10)));
    const offset = (page - 1) * limit;

    // ============================================================
    // 📊 TOTAL AGENTS (USERS TABLE SE + SEARCH)
    // ============================================================
    const totalAgentsResult = await db
      .selectFrom("users")
      .select(db.fn.count("id").as("count"))
      .where("user_type", "=", 5)
      .where("parent_username", "=", username)
      .$if(!!search?.trim(), (qb) =>
        qb.where("username", "like", `%${search.trim()}%`)
      )
      .executeTakeFirst();

    const totalAgents = Number(totalAgentsResult?.count || 0);

    // ============================================================
    // 📊 AGENT + LEADS DATA (SEARCH APPLIED)
    // ============================================================
    const agentQuery = db
      .selectFrom("users as u")
      .leftJoin("leads as l", (join) =>
        join
          .onRef("u.username", "=", "l.assigned_agent")
          .on("l.username", "=", username)
      )
      .where("u.user_type", "=", 5)
      .where("u.parent_username", "=", username)
      .$if(!!search?.trim(), (qb) =>
        qb.where("u.username", "like", `%${search.trim()}%`)
      )
      .select((eb) => [
        "u.username as agent_name",
        eb.fn.count("l.id").as("leads_assigned"),
        eb.fn
          .sum(
            eb
              .case()
              .when("l.is_converted", "=", 1)
              .then(1)
              .else(0)
              .end()
          )
          .as("leads_closed"),
      ])
      .groupBy("u.username")
      .orderBy("leads_assigned", "desc")
      .limit(limit)
      .offset(offset);

    const agentResults = await agentQuery.execute();

    // ============================================================
    // 🔄 RESPONSE TRANSFORM
    // ============================================================
    const agents = agentResults.map((row: any) => ({
      agent_name: row.agent_name,
      leads_assigned: Number(row.leads_assigned || 0),
      leads_closed: Number(row.leads_closed || 0),
    }));

    // ============================================================
    // ✅ RESPONSE
    // ============================================================
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Team productivity report fetched successfully",
      error: null,
      validation: null,
      data: {
        agents,
        pagination: {
          page,
          limit,
          total: totalAgents,
          totalPages: Math.max(1, Math.ceil(totalAgents / limit)),
          hasNextPage: page * limit < totalAgents,
          hasPreviousPage: page > 1,
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
// ─────────────────────────────────────────────────────────────────────────────
// Helper: CSV builder
// ─────────────────────────────────────────────────────────────────────────────
function buildCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ].join("\n");
}

function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(csv);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/leads
// ─────────────────────────────────────────────────────────────────────────────
export const getLeadsReport = async (
  req: FastifyRequest<{
    Querystring: {
      page?: string; limit?: string; search?: string;
      source?: string; status?: string; assigned_agent?: string;
      from?: string; to?: string; priority?: string;
      is_converted?: string; format?: string;
      campaign?: string; sub_source?: string; city?: string;
      min_score?: string; max_score?: string;
      last_contacted_from?: string; last_contacted_to?: string;
      next_followup_from?: string; next_followup_to?: string;
      created_from?: string; created_to?: string;
    };
  }>,
  reply: FastifyReply,
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

    const { page: qp = "1", limit: ql = "25", search, source, status,
      assigned_agent, from, to, priority, is_converted, format,
      campaign, sub_source, city, min_score, max_score,
      last_contacted_from, last_contacted_to,
      next_followup_from, next_followup_to,
      created_from, created_to } = req.query;

    const page  = Math.max(1, parseInt(qp, 10));
    const limit = format === "csv" ? 10000 : Math.min(100, Math.max(1, parseInt(ql, 10)));
    const offset = (page - 1) * limit;

    let q = (db as any).selectFrom("leads")
      .where("username", "=", username).where("is_duplicate", "=", 0);

    if (search?.trim()) q = q.where((eb: any) => eb.or([
      eb("full_name", "like", `%${search.trim()}%`),
      eb("email",     "like", `%${search.trim()}%`),
      eb("phone",     "like", `%${search.trim()}%`),
      eb("city",      "like", `%${search.trim()}%`),
    ]));
    if (source)         q = q.where("source",         "=", source);
    if (status)         q = q.where("status",         "=", status);
    if (assigned_agent) q = q.where("assigned_agent", "=", assigned_agent);
    if (priority)       q = q.where("priority",       "=", priority);
    if (campaign)       q = q.where("campaign",       "=", campaign);
    if (sub_source)     q = q.where("sub_source",     "=", sub_source);
    if (city)           q = q.where("city",           "=", city);
    if (is_converted !== undefined && is_converted !== "")
      q = q.where("is_converted", "=", parseInt(is_converted, 10));
    if (min_score && !isNaN(Number(min_score))) q = q.where("lead_score", ">=", Number(min_score));
    if (max_score && !isNaN(Number(max_score))) q = q.where("lead_score", "<=", Number(max_score));

    // created_at date range (from/to = created date; created_from/created_to = explicit)
    const createdFrom = created_from || from;
    const createdTo   = created_to   || to;
    if (createdFrom) { const d = new Date(createdFrom); if (!isNaN(d.getTime())) q = q.where("created_at", ">=", d); }
    if (createdTo)   { const d = new Date(createdTo);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) q = q.where("created_at", "<=", d); }

    if (last_contacted_from) { const d = new Date(last_contacted_from); if (!isNaN(d.getTime())) q = q.where("last_contacted_at", ">=", d); }
    if (last_contacted_to)   { const d = new Date(last_contacted_to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) q = q.where("last_contacted_at", "<=", d); }

    if (next_followup_from) { const d = new Date(next_followup_from); if (!isNaN(d.getTime())) q = q.where("next_followup_at", ">=", d); }
    if (next_followup_to)   { const d = new Date(next_followup_to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) q = q.where("next_followup_at", "<=", d); }

    const countResult = await q.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();
    const total = Number(countResult?.cnt ?? 0);

    const rows = await q
      .select(["id","full_name","email","phone","source","sub_source","medium",
        "campaign","status","priority","assigned_agent","lead_score","is_converted",
        "city","created_at","first_contacted_at","last_contacted_at","next_followup_at"])
      .orderBy("created_at", "desc").limit(limit).offset(offset).execute();

    if (format === "csv") {
      const csv = buildCsv(
        ["ID","Name","Email","Phone","Source","Sub Source","Medium","Campaign",
         "Status","Priority","Assigned Agent","Lead Score","Converted",
         "City","Created At","First Contacted","Last Contacted","Next Follow-up"],
        rows.map((r: any) => [
          String(r.id ?? ""), r.full_name ?? "", r.email ?? "", r.phone ?? "",
          r.source ?? "", r.sub_source ?? "", r.medium ?? "", r.campaign ?? "",
          r.status ?? "", r.priority ?? "",
          r.assigned_agent ?? "", String(r.lead_score ?? 0),
          r.is_converted ? "Yes" : "No", r.city ?? "",
          r.created_at        ? new Date(r.created_at).toLocaleString("en-IN")        : "",
          r.first_contacted_at ? new Date(r.first_contacted_at).toLocaleString("en-IN") : "",
          r.last_contacted_at ? new Date(r.last_contacted_at).toLocaleString("en-IN") : "",
          r.next_followup_at  ? new Date(r.next_followup_at).toLocaleString("en-IN")  : "",
        ]),
      );
      return sendCsv(reply, "leads-report.csv", csv);
    }

    const [sources, statuses, agents] = await Promise.all([
      (db as any).selectFrom("leads").where("username","=",username).where("is_duplicate","=",0)
        .select("source").distinct().orderBy("source","asc").execute(),
      (db as any).selectFrom("leads").where("username","=",username).where("is_duplicate","=",0)
        .select("status").distinct().orderBy("status","asc").execute(),
      (db as any).selectFrom("leads").where("username","=",username).where("is_duplicate","=",0)
        .where("assigned_agent","is not",null)
        .select("assigned_agent").distinct().orderBy("assigned_agent","asc").execute(),
    ]);

    return reply.send({ status: 1, data: {
      rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      filters: {
        sources:  sources.map((r: any)  => r.source),
        statuses: statuses.map((r: any) => r.status),
        agents:   agents.map((r: any)   => r.assigned_agent),
      },
    }});
  } catch (e: any) { req.log.error(e); return reply.status(500).send({ status: 0, message: "Server error" }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/followups
// ─────────────────────────────────────────────────────────────────────────────
export const getFollowupsReport = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string; status?: string; from?: string; to?: string; search?: string; format?: string } }>,
  reply: FastifyReply,
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
    const { page: qp = "1", limit: ql = "25", status, from, to, search, format } = req.query;
    const page  = Math.max(1, parseInt(qp, 10));
    const limit = format === "csv" ? 10000 : Math.min(100, Math.max(1, parseInt(ql, 10)));
    const offset = (page - 1) * limit;

    let q = (db as any).selectFrom("lead_followups").where("login_username", "=", username);
    if (status) q = q.where("status", "=", status);
    if (search?.trim()) q = q.where("lead_name", "like", `%${search.trim()}%`);
    if (from) { const d = new Date(from); if (!isNaN(d.getTime())) q = q.where("scheduled_at", ">=", d); }
    if (to)   { const d = new Date(to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) q = q.where("scheduled_at", "<=", d); }

    const countResult = await q.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();
    const total = Number(countResult?.cnt ?? 0);
    const rows = await q.select(["id","lead_id","lead_name","scheduled_at","notes","status","completed_at","created_at"])
      .orderBy("scheduled_at","asc").limit(limit).offset(offset).execute();

    const summaryRows = await (db as any).selectFrom("lead_followups").where("login_username","=",username)
      .select(["status", sql`COUNT(*)`.as("cnt")]).groupBy("status").execute();
    const summary: Record<string, number> = {};
    for (const r of summaryRows) summary[r.status] = Number(r.cnt);
    const overdueResult = await (db as any).selectFrom("lead_followups").where("login_username","=",username)
      .where("status","=","pending").where("scheduled_at","<",new Date())
      .select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();

    if (format === "csv") {
      const csv = buildCsv(
        ["ID","Lead ID","Lead Name","Scheduled At","Status","Notes","Completed At","Created At"],
        rows.map((r: any) => [
          String(r.id), String(r.lead_id), r.lead_name ?? "",
          r.scheduled_at  ? new Date(r.scheduled_at).toLocaleString("en-IN")  : "",
          r.status ?? "", (r.notes ?? "").replace(/\n/g," "),
          r.completed_at  ? new Date(r.completed_at).toLocaleString("en-IN")  : "",
          r.created_at    ? new Date(r.created_at).toLocaleString("en-IN")    : "",
        ]),
      );
      return sendCsv(reply, "followups-report.csv", csv);
    }

    return reply.send({ status: 1, data: {
      rows,
      summary: { pending: summary["pending"] ?? 0, completed: summary["completed"] ?? 0, cancelled: summary["cancelled"] ?? 0, overdue: Number(overdueResult?.cnt ?? 0) },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }});
  } catch (e: any) { req.log.error(e); return reply.status(500).send({ status: 0, message: "Server error" }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/activities
// ─────────────────────────────────────────────────────────────────────────────
export const getActivitiesReport = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string; activity_type?: string; channel?: string; from?: string; to?: string; search?: string; format?: string } }>,
  reply: FastifyReply,
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
    const { page: qp = "1", limit: ql = "25", activity_type, channel, from, to, search, format } = req.query;
    const page  = Math.max(1, parseInt(qp, 10));
    const limit = format === "csv" ? 10000 : Math.min(100, Math.max(1, parseInt(ql, 10)));
    const offset = (page - 1) * limit;

    let q = (db as any).selectFrom("lead_activities").where("login_username", "=", username);
    if (activity_type)  q = q.where("activity_type", "=", activity_type);
    if (channel)        q = q.where("channel",        "=", channel);
    if (search?.trim()) q = q.where("lead_name",      "like", `%${search.trim()}%`);
    if (from) { const d = new Date(from); if (!isNaN(d.getTime())) q = q.where("created_at", ">=", d); }
    if (to)   { const d = new Date(to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) q = q.where("created_at", "<=", d); }

    const countResult = await q.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();
    const total = Number(countResult?.cnt ?? 0);
    const rows = await q
      .select(["id","lead_id","lead_name","activity_type","action","status","source","channel","direction","description","created_at"])
      .orderBy("created_at","desc").limit(limit).offset(offset).execute();

    const typeBreakdown = await (db as any).selectFrom("lead_activities").where("login_username","=",username)
      .select(["activity_type", sql`COUNT(*)`.as("cnt")]).groupBy("activity_type").execute();

    if (format === "csv") {
      const csv = buildCsv(
        ["ID","Lead ID","Lead Name","Type","Action","Status","Channel","Direction","Description","Date"],
        rows.map((r: any) => [
          String(r.id), String(r.lead_id ?? ""), r.lead_name ?? "",
          r.activity_type ?? "", r.action ?? "", r.status ?? "",
          r.channel ?? "", r.direction ?? "", (r.description ?? "").replace(/\n/g," "),
          r.created_at ? new Date(r.created_at).toLocaleString("en-IN") : "",
        ]),
      );
      return sendCsv(reply, "activities-report.csv", csv);
    }

    return reply.send({ status: 1, data: {
      rows,
      type_breakdown: typeBreakdown.map((r: any) => ({ activity_type: r.activity_type, count: Number(r.cnt) })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }});
  } catch (e: any) { req.log.error(e); return reply.status(500).send({ status: 0, message: "Server error" }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/conversations
// ─────────────────────────────────────────────────────────────────────────────
export const getConversationsReport = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string; channel?: string; conv_status?: string; assigned_to?: string; from?: string; to?: string; format?: string } }>,
  reply: FastifyReply,
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
    const { page: qp = "1", limit: ql = "25", channel, conv_status, assigned_to, from, to, format } = req.query;
    const page  = Math.max(1, parseInt(qp, 10));
    const limit = format === "csv" ? 10000 : Math.min(100, Math.max(1, parseInt(ql, 10)));
    const offset = (page - 1) * limit;

    let q = (db as any).selectFrom("chat_message_summary").where("username", "=", username);
    if (channel)     q = q.where("channel",     "=", channel);
    if (conv_status) q = q.where("conv_status", "=", conv_status);
    if (assigned_to) q = q.where("assigned_to", "=", assigned_to);
    if (from) { const d = new Date(from); if (!isNaN(d.getTime())) q = q.where("created_at", ">=", d); }
    if (to)   { const d = new Date(to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) q = q.where("created_at", "<=", d); }

    const countResult = await q.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();
    const total = Number(countResult?.cnt ?? 0);
    const rows = await q
      .select(["conversation_id","channel","receiver_id","contact_name","last_message","last_message_type",
        "last_message_at","conv_status","assigned_to","unread_count","is_starred","created_at","resolved_at"])
      .orderBy("last_message_at","desc").limit(limit).offset(offset).execute();

    const [statusBD, channelBD] = await Promise.all([
      (db as any).selectFrom("chat_message_summary").where("username","=",username)
        .select(["conv_status", sql`COUNT(*)`.as("cnt")]).groupBy("conv_status").execute(),
      (db as any).selectFrom("chat_message_summary").where("username","=",username)
        .select(["channel", sql`COUNT(*)`.as("cnt")]).groupBy("channel").execute(),
    ]);

    if (format === "csv") {
      const csv = buildCsv(
        ["Conversation ID","Channel","Phone/ID","Contact Name","Last Message","Type","Status","Assigned To","Unread","Last Message At","Resolved At"],
        rows.map((r: any) => [
          r.conversation_id ?? "", r.channel ?? "", r.receiver_id ?? "",
          r.contact_name ?? "", (r.last_message ?? "").replace(/\n/g," "),
          r.last_message_type ?? "", r.conv_status ?? "", r.assigned_to ?? "",
          String(r.unread_count ?? 0),
          r.last_message_at ? new Date(r.last_message_at).toLocaleString("en-IN") : "",
          r.resolved_at     ? new Date(r.resolved_at).toLocaleString("en-IN")     : "",
        ]),
      );
      return sendCsv(reply, "conversations-report.csv", csv);
    }

    return reply.send({ status: 1, data: {
      rows,
      status_breakdown:  statusBD.map((r: any)  => ({ status: r.conv_status, count: Number(r.cnt) })),
      channel_breakdown: channelBD.map((r: any) => ({ channel: r.channel,    count: Number(r.cnt) })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }});
  } catch (e: any) { req.log.error(e); return reply.status(500).send({ status: 0, message: "Server error" }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/daily-summary
// ─────────────────────────────────────────────────────────────────────────────
export const getDailySummary = async (
  req: FastifyRequest<{ Querystring: { from?: string; to?: string; format?: string } }>,
  reply: FastifyReply,
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
    const { from, to, format } = req.query;
    const defaultFrom = new Date(); defaultFrom.setDate(defaultFrom.getDate() - 29); defaultFrom.setHours(0,0,0,0);
    const fromDate = from ? new Date(from) : defaultFrom;
    const toDate   = to ? (() => { const d = new Date(to); d.setHours(23,59,59,999); return d; })() : new Date();

    const [leadRows, msgRows, convRows] = await Promise.all([
      (db as any).selectFrom("leads").where("username","=",username).where("is_duplicate","=",0)
        .where("created_at",">=",fromDate).where("created_at","<=",toDate)
        .select([sql`DATE(created_at)`.as("date"), sql`COUNT(*)`.as("new_leads"), sql`SUM(CASE WHEN is_converted=1 THEN 1 ELSE 0 END)`.as("converted")])
        .groupBy(sql`DATE(created_at)`).orderBy(sql`DATE(created_at)`,"asc").execute(),
      (db as any).selectFrom("chat_messages").where("username","=",username)
        .where("created_at",">=",fromDate).where("created_at","<=",toDate)
        .select([sql`DATE(created_at)`.as("date"), sql`COUNT(*)`.as("total_messages"), sql`SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END)`.as("inbound"), sql`SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END)`.as("outbound")])
        .groupBy(sql`DATE(created_at)`).execute(),
      (db as any).selectFrom("chat_message_summary").where("username","=",username)
        .where("created_at",">=",fromDate).where("created_at","<=",toDate)
        .select([sql`DATE(created_at)`.as("date"), sql`COUNT(*)`.as("new_conversations")])
        .groupBy(sql`DATE(created_at)`).execute(),
    ]);

    type DayRow = { date: string; new_leads: number; converted: number; total_messages: number; inbound: number; outbound: number; new_conversations: number };
    const dateMap: Record<string, DayRow> = {};
    const init = (d: string) => { if (!dateMap[d]) dateMap[d] = { date: d, new_leads: 0, converted: 0, total_messages: 0, inbound: 0, outbound: 0, new_conversations: 0 }; };
    for (const r of leadRows) { init(String(r.date)); dateMap[String(r.date)].new_leads = Number(r.new_leads); dateMap[String(r.date)].converted = Number(r.converted); }
    for (const r of msgRows)  { init(String(r.date)); dateMap[String(r.date)].total_messages = Number(r.total_messages); dateMap[String(r.date)].inbound = Number(r.inbound); dateMap[String(r.date)].outbound = Number(r.outbound); }
    for (const r of convRows) { init(String(r.date)); dateMap[String(r.date)].new_conversations = Number(r.new_conversations); }

    const rows = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

    if (format === "csv") {
      const csv = buildCsv(
        ["Date","New Leads","Converted","Total Messages","Inbound","Outbound","New Conversations"],
        rows.map((r) => [r.date, String(r.new_leads), String(r.converted), String(r.total_messages), String(r.inbound), String(r.outbound), String(r.new_conversations)]),
      );
      return sendCsv(reply, "daily-summary.csv", csv);
    }

    return reply.send({ status: 1, data: rows });
  } catch (e: any) { req.log.error(e); return reply.status(500).send({ status: 0, message: "Server error" }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/lead-ageing
// Stale leads bucketed by days since last contact / creation
// Query: bucket=contacted|created, from, to, source, status, format=csv
// ─────────────────────────────────────────────────────────────────────────────
export const getLeadAgeing = async (
  req: FastifyRequest<{
    Querystring: { bucket?: string; source?: string; status?: string; assigned_agent?: string; from?: string; to?: string; format?: string; page?: string; limit?: string };
  }>,
  reply: FastifyReply,
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

    const { bucket = "contacted", source, status, assigned_agent, from, to, format, page: qp = "1", limit: ql = "25" } = req.query;
    const page  = Math.max(1, parseInt(qp, 10));
    const limit = format === "csv" ? 10000 : Math.min(100, Math.max(1, parseInt(ql, 10)));
    const offset = (page - 1) * limit;

    // The "age" column: if bucket=contacted use last_contacted_at (or created_at if never contacted); else use created_at
    const ageCol = bucket === "contacted"
      ? sql`COALESCE(last_contacted_at, created_at)`
      : sql`created_at`;

    let q = (db as any).selectFrom("leads")
      .where("username", "=", username)
      .where("is_duplicate", "=", 0)
      .where("is_converted", "=", 0)
      .where("is_archived", "=", 0);

    if (source)         q = q.where("source",         "=", source);
    if (status)         q = q.where("status",         "=", status);
    if (assigned_agent) q = q.where("assigned_agent", "=", assigned_agent);
    if (from) { const d = new Date(from); if (!isNaN(d.getTime())) q = q.where("created_at", ">=", d); }
    if (to)   { const d = new Date(to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) q = q.where("created_at", "<=", d); }

    // Age bucket summary (always full table, no pagination)
    const bucketSummary = await q
      .select([
        sql`CASE
          WHEN DATEDIFF(NOW(), ${ageCol}) <= 3  THEN '0-3 days'
          WHEN DATEDIFF(NOW(), ${ageCol}) <= 7  THEN '4-7 days'
          WHEN DATEDIFF(NOW(), ${ageCol}) <= 14 THEN '8-14 days'
          WHEN DATEDIFF(NOW(), ${ageCol}) <= 30 THEN '15-30 days'
          WHEN DATEDIFF(NOW(), ${ageCol}) <= 60 THEN '31-60 days'
          ELSE '60+ days'
        END`.as("age_bucket"),
        sql`COUNT(*)`.as("count"),
        sql`AVG(lead_score)`.as("avg_score"),
      ])
      .groupBy(sql`CASE
        WHEN DATEDIFF(NOW(), ${ageCol}) <= 3  THEN '0-3 days'
        WHEN DATEDIFF(NOW(), ${ageCol}) <= 7  THEN '4-7 days'
        WHEN DATEDIFF(NOW(), ${ageCol}) <= 14 THEN '8-14 days'
        WHEN DATEDIFF(NOW(), ${ageCol}) <= 30 THEN '15-30 days'
        WHEN DATEDIFF(NOW(), ${ageCol}) <= 60 THEN '31-60 days'
        ELSE '60+ days'
      END`)
      .execute();

    const BUCKET_ORDER = ["0-3 days","4-7 days","8-14 days","15-30 days","31-60 days","60+ days"];
    const summaryMap: Record<string, any> = {};
    for (const r of bucketSummary) summaryMap[r.age_bucket] = { age_bucket: r.age_bucket, count: Number(r.count), avg_score: parseFloat((Number(r.avg_score) || 0).toFixed(1)) };
    const buckets = BUCKET_ORDER.map((b) => summaryMap[b] ?? { age_bucket: b, count: 0, avg_score: 0 });

    // Paginated lead rows with age_days
    const countResult = await q.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();
    const total = Number(countResult?.cnt ?? 0);

    const rows = await q
      .select([
        "id", "full_name", "phone", "email", "source", "status",
        "assigned_agent", "lead_score", "last_contacted_at",
        "first_contacted_at", "created_at",
        sql`DATEDIFF(NOW(), ${ageCol})`.as("age_days"),
      ])
      .orderBy(sql`DATEDIFF(NOW(), ${ageCol})`, "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    if (format === "csv") {
      const csv = buildCsv(
        ["ID","Name","Phone","Email","Source","Status","Agent","Score","Age (Days)","Last Contacted","Created At"],
        rows.map((r: any) => [
          String(r.id), r.full_name ?? "", r.phone ?? "", r.email ?? "",
          r.source ?? "", r.status ?? "", r.assigned_agent ?? "", String(r.lead_score ?? 0),
          String(r.age_days ?? ""),
          r.last_contacted_at ? new Date(r.last_contacted_at).toLocaleString("en-IN") : "Never",
          r.created_at        ? new Date(r.created_at).toLocaleString("en-IN")        : "",
        ]),
      );
      return sendCsv(reply, "lead-ageing.csv", csv);
    }

    return reply.send({ status: 1, data: { buckets, rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (e: any) { req.log.error(e); return reply.status(500).send({ status: 0, message: "Server error" }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/campaign-attribution
// UTM campaign / medium / landing_page performance
// Query: group_by=campaign|medium|source|landing_page, from, to, format=csv
// ─────────────────────────────────────────────────────────────────────────────
export const getCampaignAttribution = async (
  req: FastifyRequest<{ Querystring: { group_by?: string; from?: string; to?: string; format?: string } }>,
  reply: FastifyReply,
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

    const { group_by = "campaign", from, to, format } = req.query;
    const allowedCols: Record<string, string> = {
      campaign: "campaign", medium: "medium",
      source: "source", landing_page: "landing_page",
    };
    const col = allowedCols[group_by] ?? "campaign";

    let q = (db as any).selectFrom("leads").where("username", "=", username).where("is_duplicate", "=", 0);
    if (from) { const d = new Date(from); if (!isNaN(d.getTime())) q = q.where("created_at", ">=", d); }
    if (to)   { const d = new Date(to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) q = q.where("created_at", "<=", d); }

    const rows = await q
      .select([
        col,
        sql`COUNT(*)`.as("total_leads"),
        sql`SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END)`.as("converted"),
        sql`AVG(lead_score)`.as("avg_score"),
        sql`SUM(COALESCE(lead_value, 0))`.as("total_value"),
        sql`COUNT(DISTINCT assigned_agent)`.as("agents_involved"),
      ])
      .groupBy(col)
      .orderBy(sql`COUNT(*)`, "desc")
      .execute();

    const data = rows
      .filter((r: any) => r[col]) // skip nulls
      .map((r: any) => {
        const total = Number(r.total_leads);
        const converted = Number(r.converted);
        return {
          [col]: r[col] || "(none)",
          total_leads: total,
          converted,
          conversion_rate: total > 0 ? ((converted / total) * 100).toFixed(1) + "%" : "0%",
          avg_lead_score: parseFloat((Number(r.avg_score) || 0).toFixed(1)),
          total_value: Number(r.total_value ?? 0),
          agents_involved: Number(r.agents_involved),
        };
      });

    if (format === "csv") {
      const labelCol = col.charAt(0).toUpperCase() + col.slice(1).replace("_", " ");
      const csv = buildCsv(
        [labelCol, "Total Leads", "Converted", "CVR", "Avg Score", "Total Value", "Agents"],
        data.map((r: any) => [
          String(r[col]), String(r.total_leads), String(r.converted),
          r.conversion_rate, String(r.avg_lead_score),
          String(r.total_value), String(r.agents_involved),
        ]),
      );
      return sendCsv(reply, `campaign-${col}.csv`, csv);
    }

    return reply.send({ status: 1, data });
  } catch (e: any) { req.log.error(e); return reply.status(500).send({ status: 0, message: "Server error" }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/hot-leads
// High-score unconverted leads — prioritization report for agents
// Query: min_score (default 15), source, status, assigned_agent, page, limit, format=csv
// ─────────────────────────────────────────────────────────────────────────────
export const getHotLeads = async (
  req: FastifyRequest<{ Querystring: { min_score?: string; source?: string; status?: string; assigned_agent?: string; page?: string; limit?: string; format?: string } }>,
  reply: FastifyReply,
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

    const { min_score = "15", source, status, assigned_agent, page: qp = "1", limit: ql = "25", format } = req.query;
    const page   = Math.max(1, parseInt(qp, 10));
    const limit  = format === "csv" ? 10000 : Math.min(100, Math.max(1, parseInt(ql, 10)));
    const offset = (page - 1) * limit;
    const minScore = parseInt(min_score, 10);

    let q = (db as any).selectFrom("leads")
      .where("username",     "=", username)
      .where("is_duplicate", "=", 0)
      .where("is_converted", "=", 0)
      .where("is_archived",  "=", 0)
      .where("lead_score",   ">=", minScore);

    if (source)         q = q.where("source",         "=", source);
    if (status)         q = q.where("status",         "=", status);
    if (assigned_agent) q = q.where("assigned_agent", "=", assigned_agent);

    const countResult = await q.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();
    const total = Number(countResult?.cnt ?? 0);

    const rows = await q
      .select([
        "id", "full_name", "phone", "email", "source", "status",
        "priority", "assigned_agent", "lead_score", "last_contacted_at",
        "next_followup_at", "created_at",
        sql`DATEDIFF(NOW(), COALESCE(last_contacted_at, created_at))`.as("days_since_contact"),
      ])
      .orderBy("lead_score", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    // Score distribution for mini chart
    const scoreDist = await (db as any).selectFrom("leads")
      .where("username", "=", username).where("is_duplicate", "=", 0).where("is_converted", "=", 0)
      .select([
        sql`FLOOR(lead_score / 5) * 5`.as("bucket"),
        sql`COUNT(*)`.as("count"),
      ])
      .groupBy(sql`FLOOR(lead_score / 5) * 5`)
      .orderBy(sql`FLOOR(lead_score / 5) * 5`, "asc")
      .execute();

    if (format === "csv") {
      const csv = buildCsv(
        ["ID","Name","Phone","Email","Source","Status","Priority","Agent","Score","Days Since Contact","Next Follow-up","Created"],
        rows.map((r: any) => [
          String(r.id), r.full_name ?? "", r.phone ?? "", r.email ?? "",
          r.source ?? "", r.status ?? "", r.priority ?? "", r.assigned_agent ?? "",
          String(r.lead_score ?? 0), String(r.days_since_contact ?? ""),
          r.next_followup_at ? new Date(r.next_followup_at).toLocaleString("en-IN") : "Not set",
          r.created_at       ? new Date(r.created_at).toLocaleString("en-IN")       : "",
        ]),
      );
      return sendCsv(reply, "hot-leads.csv", csv);
    }

    return reply.send({
      status: 1,
      data: {
        rows,
        score_distribution: scoreDist.map((r: any) => ({ range: `${r.bucket}-${Number(r.bucket)+4}`, count: Number(r.count) })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (e: any) { req.log.error(e); return reply.status(500).send({ status: 0, message: "Server error" }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/unassigned-leads
// Leads without an agent — manager action-item report
// Query: source, status, min_score, from, to, page, limit, format=csv
// ─────────────────────────────────────────────────────────────────────────────
export const getUnassignedLeads = async (
  req: FastifyRequest<{ Querystring: { source?: string; status?: string; min_score?: string; from?: string; to?: string; page?: string; limit?: string; format?: string } }>,
  reply: FastifyReply,
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

    const { source, status, min_score, from, to, page: qp = "1", limit: ql = "25", format } = req.query;
    const page   = Math.max(1, parseInt(qp, 10));
    const limit  = format === "csv" ? 10000 : Math.min(100, Math.max(1, parseInt(ql, 10)));
    const offset = (page - 1) * limit;

    let q = (db as any).selectFrom("leads")
      .where("username",     "=", username)
      .where("is_duplicate", "=", 0)
      .where("is_converted", "=", 0)
      .where((eb: any) => eb.or([
        eb("assigned_agent", "is",  null),
        eb("assigned_agent", "=",   ""),
      ]));

    if (source)    q = q.where("source",     "=", source);
    if (status)    q = q.where("status",     "=", status);
    if (min_score) q = q.where("lead_score", ">=", parseInt(min_score, 10));
    if (from) { const d = new Date(from); if (!isNaN(d.getTime())) q = q.where("created_at", ">=", d); }
    if (to)   { const d = new Date(to);   d.setHours(23,59,59,999); if (!isNaN(d.getTime())) q = q.where("created_at", "<=", d); }

    const countResult = await q.select((eb: any) => eb.fn.countAll().as("cnt")).executeTakeFirst();
    const total = Number(countResult?.cnt ?? 0);

    const rows = await q
      .select([
        "id", "full_name", "phone", "email", "source", "status",
        "lead_score", "created_at", "last_contacted_at",
        sql`DATEDIFF(NOW(), created_at)`.as("age_days"),
      ])
      .orderBy("lead_score", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    // Source breakdown of unassigned
    const sourceBD = await (db as any).selectFrom("leads")
      .where("username", "=", username).where("is_duplicate", "=", 0).where("is_converted", "=", 0)
      .where((eb: any) => eb.or([eb("assigned_agent","is",null), eb("assigned_agent","=","")]))
      .select(["source", sql`COUNT(*)`.as("cnt")]).groupBy("source").orderBy(sql`COUNT(*)`,"desc").execute();

    if (format === "csv") {
      const csv = buildCsv(
        ["ID","Name","Phone","Email","Source","Status","Score","Age (Days)","Last Contacted","Created"],
        rows.map((r: any) => [
          String(r.id), r.full_name ?? "", r.phone ?? "", r.email ?? "",
          r.source ?? "", r.status ?? "", String(r.lead_score ?? 0), String(r.age_days ?? ""),
          r.last_contacted_at ? new Date(r.last_contacted_at).toLocaleString("en-IN") : "Never",
          r.created_at        ? new Date(r.created_at).toLocaleString("en-IN")        : "",
        ]),
      );
      return sendCsv(reply, "unassigned-leads.csv", csv);
    }

    return reply.send({
      status: 1,
      data: {
        rows,
        source_breakdown: sourceBD.map((r: any) => ({ source: r.source ?? "Unknown", count: Number(r.cnt) })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (e: any) { req.log.error(e); return reply.status(500).send({ status: 0, message: "Server error" }); }
};
