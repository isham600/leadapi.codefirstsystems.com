
import { FastifyRequest, FastifyReply } from "fastify";
import { sql } from "kysely";
import { db } from "../../../models/db.js";

// ============================================================
// 🔐  GET ALL AGENT  CONTROLLER
// ============================================================

//with pagination
// export const getAgents = async (
//   req: FastifyRequest,
//   reply: FastifyReply
// ) => {
//   const {
//     page = 1,
//     limit = 10,
//     search,
//     sort = "asc",
//   } = req.query as any;

//   // 🔐 token se username
//   const loggedInUsername = (req as any).user?.username;

//   if (!loggedInUsername) {
//     return reply.status(401).send({
//       status: 0,
//       statuscode: 401,
//       message: "Unauthorized",
//       data: null,
//       error: "invalid_token",
//       validation: null,
//     });
//   }

//   const offset = (Number(page) - 1) * Number(limit);

//   try {
//     // 🔹 Common filter builder
//     const buildFilters = (query: any) => {
//       // ✅ Sirf agents
//       query = query
//         .where("user_type", "=", 5)
//         // ✅ parent_name = token.username
//         .where("parent_username", "=", loggedInUsername);

//       // 🔍 Search filter
//       if (search) {
//         query = query.where((eb: any) =>
//           eb.or([
//             eb("username", "like", `%${search}%`),
//             eb("firstname", "like", `%${search}%`),
//             eb("lastname", "like", `%${search}%`),
//           ])
//         );
//       }

//       return query;
//     };

//     // 🔹 Count query
//     let countQuery = db
//       .selectFrom("users")
//       .select(db.fn.count("id").as("count"));

//     countQuery = buildFilters(countQuery);
//     const countResult = await countQuery.executeTakeFirst();
//     const total = Number(countResult?.count || 0);

//     // 🔹 Data query
//     let query = db
//       .selectFrom("users")
//       .select([
//         "id",
//         "username",
//         "firstname",
//         "lastname",
//         "parent_username",
//       ]);

//     query = buildFilters(query);

//     // 🔹 Sorting
//     query =
//       sort === "desc"
//         ? query.orderBy("created_at", "desc")
//         : query.orderBy("created_at", "asc");

//     // 🔹 Pagination
//     const agents = await query
//       .limit(Number(limit))
//       .offset(Number(offset))
//       .execute();

//     return reply.status(200).send({
//       status: 1,
//       statuscode: 200,
//       message: "Agents fetched successfully",
//       data: {
//         list: agents,
//         pagination: {
//           page: Number(page),
//           limit: Number(limit),
//           total,
//           totalPages: Math.ceil(total / Number(limit)),
//         },
//       },
//       error: null,
//       validation: null,
//     });
//   } catch (err) {
//     console.error(err);
//     return reply.status(500).send({
//       status: 0,
//       statuscode: 500,
//       message: "Failed to fetch agents",
//       data: null,
//       error: "server_error",
//       validation: null,
//     });
//   }
// };


export const getAgents = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const { search, sort = "asc" } = req.query as any;

  // 🔐 token se username
  const loggedInUsername = (req as any).user?.username;

  if (!loggedInUsername) {
    return reply.status(401).send({
      status: 0,
      statuscode: 401,
      message: "Unauthorized",
      data: null,
      error: "invalid_token",
      validation: null,
    });
  }

  try {
    // 🔹 Common filter builder
    const buildFilters = (query: any) => {
      query = query
        // ✅ Sirf agents
        .where("user_type", "=", 5)
        // ✅ admin ke child agents
        .where("parent_username", "=", loggedInUsername);

      // 🔍 Search filter
      if (search) {
        query = query.where((eb: any) =>
          eb.or([
            eb("username", "like", `%${search}%`),
            eb("firstname", "like", `%${search}%`),
            eb("lastname", "like", `%${search}%`),
            eb("email", "like", `%${search}%`),
          ])
        );
      }

      return query;
    };

    // 🔹 Data query (NO pagination)
    let query = db
      .selectFrom("users")
      .select([
        "id",
        "username",
        "firstname",
        "lastname",
        "email",            // ✅ email added
        "parent_username",
      ]);

    query = buildFilters(query);

    // 🔹 Sorting
    query =
      sort === "desc"
        ? query.orderBy("created_at", "desc")
        : query.orderBy("created_at", "asc");

    const agents = await query.execute();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Agents fetched successfully",
      data: {
        list: agents,
      },
      error: null,
      validation: null,
    });
  } catch (err) {
    console.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch agents",
      data: null,
      error: "server_error",
      validation: null,
    });
  }
};




// ============================================================
// 🔐 AGENT NAME CHANGE CONTROLLER
// ============================================================


export const updateLeadAgents = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // 🔐 Admin username from JWT
    const parentUsername = (req as any).user?.username;

    if (!parentUsername) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        data: null,
        error: "token_invalid",
        validation: null,
      });
    }

    // 🆔 Params
    const { id } = req.params as { id: string };

    // 📦 Body
    const { agent } = req.body as { agent: string };

    // Allow empty string or "Unassigned" for unassigning
    const agentValue = agent === "" || agent === "Unassigned" ? null : agent;

    // 🔍 If agent is assigned, fetch the agent's ID from users table
    let agentIdValue: string | null = null;
    if (agentValue) {
      const agentUser = await db
        .selectFrom("users")
        .select(["id"])
        .where("username", "=", agentValue)
        .where("user_type", "=", 5) // Ensure it's an agent
        .executeTakeFirst();

      if (agentUser) {
        agentIdValue = String(agentUser.id);
      }
    }

    // 🔍 Check lead exists and get old assigned_agent
    const lead = await db
      .selectFrom("leads")
      .select(["id", "full_name", "email", "username", "assigned_agent", "owner_id"])
      .where("id", "=", Number(id))
      .executeTakeFirst();

    if (!lead) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Lead not found",
        data: null,
        error: "not_found",
        validation: null,
      });
    }

    const oldAgent = lead.assigned_agent || "";
    const oldOwnerId = lead.owner_id || "";

    // 🔄 Update agent and owner_id
    await db
      .updateTable("leads")
      .set({
        assigned_agent: agentValue,
        owner_id: agentIdValue,
        updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      })
      .where("id", "=", Number(id))
      .execute();

    // 📜 Store in lead_history table
    // try {
    //   await db.insertInto("lead_history").values({
    //     lead_id: Number(id),
    //     lead_username: lead.username || null,
    //     field_name: "assigned_agent",
    //     old_value: oldAgent || null,
    //     new_value: agent || null,
    //     event_type: "updated",
    //     action: "assigned_agent_updated",
    //     description: `Lead assigned agent changed from "${oldAgent || "Unassigned"}" to "${agent || "Unassigned"}" by ${parentUsername}`,
    //     login_username: parentUsername,
    //     created_at: new Date(),
    //   }).execute();
    // } catch (historyError) {
    //   console.error("Error adding lead history:", historyError);
    //   // Don't fail the request if history insertion fails
    // }

    // 🧾 Store in lead_activities table
    // try {
    //   await db.insertInto("lead_activities").values({
    //     lead_id: Number(id),
    //     lead_name: lead.full_name || lead.email || "",
    //     lead_username: lead.username || null,
    //     activity_type: "assigned",
    //     action: "assigned_agent_updated",
    //     description: `Lead assigned agent changed from "${oldAgent || "Unassigned"}" to "${agent || "Unassigned"}" by ${parentUsername}`,
    //     login_username: parentUsername,
    //     created_at: new Date(),
    //   }).execute();
    // } catch (activityError) {
    //   console.error("Error adding lead activity:", activityError);
    //   // Don't fail the request if activity insertion fails
    // }

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Assigned agent updated successfully",
      data: {
        id: Number(id),
        assigned_agent: agentValue,
        owner_id: agentIdValue,
      },
      error: null,
      validation: null,
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      data: null,
      error: "server_error",
      validation: null,
    });
  }
};






