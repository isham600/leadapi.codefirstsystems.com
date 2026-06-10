import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
 

export interface ActivityLogQuery {
  page?: string;
  limit?: string;
  action?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Get activity logs for the authenticated user
 * Supports pagination, filtering by action, and search
 */


 
// ============================================================
// 🔄 GET ACTIVITY LOGS CONTROLLER
// ============================================================
// export const getActivityLogs = async (
//   // req: FastifyRequest<{ Querystring: ActivityLogQuery }>,
//   req: FastifyRequest<{ Querystring: ActivityLogQuery }>,

//   reply: FastifyReply
// ) => {
//   try {
//     // Get username from token (set by verifyJwt middleware)
//     const username = req.user?.username;
//      const uuid = req.user?.uuid;

//     // if (!username) {
//     //   return reply.status(401).send({
//     //     status: 0,
//     //     statuscode: 401,
//     //     message: "Unauthorized - username not found in token",
//     //     error: "token_invalid",
//     //     data: null,
//     //     validation: null,
//     //   });
//     // }

//     // Extract query parameters
//     const page = parseInt(req.query.page || "1", 10);
//     const limit = parseInt(req.query.limit || "20", 10);
//     const action = req.query.action;
//     const search = req.query.search;
//     const startDate = req.query.startDate;
//     const endDate = req.query.endDate;

//     // Validate pagination parameters
//     if (page < 1) {
//       return reply.status(400).send({
//         status: 0,
//         statuscode: 400,
//         message: "Page number must be greater than 0",
//         error: "invalid_page",
//         data: null,
//         validation: null,
//       });
//     }

//     if (limit < 1 || limit > 100) {
//       return reply.status(400).send({
//         status: 0,
//         statuscode: 400,
//         message: "Limit must be between 1 and 100",
//         error: "invalid_limit",
//         data: null,
//         validation: null,
//       });
//     }

//     const offset = (page - 1) * limit;

//     // Helper function to build base query with filters
//     const buildBaseQuery = () => {
//       let baseQuery = db
//         .selectFrom("activity_log")
//         .where("uuid", "=", uuid);

//       // Filter by action if provided
//       if (action) {
//         baseQuery = baseQuery.where("action", "=", action);
//       }

//       // Filter by date range if provided
//       if (startDate) {
//         const start = new Date(startDate);
//         if (!isNaN(start.getTime())) {
//           baseQuery = baseQuery.where("created_at", ">=", start);
//         }
//       }

//       if (endDate) {
//         const end = new Date(endDate);
//         if (!isNaN(end.getTime())) {
//           // Add one day to include the entire end date
//           end.setHours(23, 59, 59, 999);
//           baseQuery = baseQuery.where("created_at", "<=", end);
//         }
//       }

//       // Search in description and action fields
//       if (search) {
//         baseQuery = baseQuery.where((eb) =>
//           eb.or([
//             eb("description", "like", `%${search}%`),
//             eb("action", "like", `%${search}%`),
//           ])
//         );
//       }

//       return baseQuery;
//     };

//     // Get total count for pagination
//     const countQuery = buildBaseQuery().select((eb) => eb.fn.countAll().as("total"));
//     const countResult = await countQuery.executeTakeFirst();
//     const total = Number(countResult?.total || 0);

//     // Get paginated results
//     const query = buildBaseQuery()
//       .selectAll()
//       .orderBy("created_at", "desc")
//       .limit(limit)
//       .offset(offset);
    
//     const logs = await query.execute();

//     // Calculate pagination metadata
//     const totalPages = Math.ceil(total / limit);
//     const hasNextPage = page < totalPages;
//     const hasPreviousPage = page > 1;

//     return reply.status(200).send({
//       status: 1,
//       statuscode: 200,
//       message: "Activity logs fetched successfully",
//       error: null,
//       validation: null,
//       data: {
//         logs,
//         pagination: {
//           page,
//           limit,
//           total,
//           totalPages,
//           hasNextPage,
//           hasPreviousPage,
//         },
//         filters: {
//           action: action || null,
//           search: search || null,
//           startDate: startDate || null,
//           endDate: endDate || null,
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




export const getActivityLogs = async (
  req: FastifyRequest<{ Querystring: ActivityLogQuery }>,
  reply: FastifyReply
) => {
  try {
    // Get user info from token (set by verifyJwt middleware)
    const username = req.user?.username;
    const userType = req.user?.user_type; // 1 = Super Admin, 2 = Admin, 3 = Reseller, 5 = Agent

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - username not found in token",
        error: "token_invalid",
        data: null,
        validation: null,
      });
    }

    // Extract query parameters
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "20", 10);
    const action = req.query.action;
    const search = req.query.search;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    // Validate pagination parameters
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

    // Helper function to build base query with role-based access control
    const buildBaseQuery = () => {
      let baseQuery = db.selectFrom("activity_log");

      // Apply role-based filtering
      if (userType === 2 || userType === 1) {
        // Admin or Super Admin: Can see their own activity + their subordinates' activity
        // First, get all subordinate usernames
        const subordinateSubquery = db
          .selectFrom("users")
          .select("username")
          .where("parent_username", "=", username);

        // Get activities where username = admin's username OR username is in subordinates list
        baseQuery = baseQuery.where((eb) =>
          eb.or([
            eb("username", "=", username),
            eb("username", "in", subordinateSubquery),
          ])
        );
      } else {
        // Reseller (3) and Agent (5): Can only see their own activity
        baseQuery = baseQuery.where("username", "=", username);
      }

      // Filter by action if provided
      if (action) {
        baseQuery = baseQuery.where("action", "=", action);
      }

      // Filter by date range if provided
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          baseQuery = baseQuery.where("created_at", ">=", start);
        }
      }

      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          // Add one day to include the entire end date
          end.setHours(23, 59, 59, 999);
          baseQuery = baseQuery.where("created_at", "<=", end);
        }
      }

      // Search in description, action, and username fields
      if (search) {
        baseQuery = baseQuery.where((eb) =>
          eb.or([
            eb("description", "like", `%${search}%`),
            eb("action", "like", `%${search}%`),
            eb("username", "like", `%${search}%`),
          ])
        );
      }

      return baseQuery;
    };

    // Get total count for pagination
    const countQuery = buildBaseQuery().select((eb) => eb.fn.countAll().as("total"));
    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.total || 0);

    // Get paginated results with all fields
    const query = buildBaseQuery()
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset);
    
    const logs = await query.execute();

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Activity logs fetched successfully",
      error: null,
      validation: null,
      data: {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage,
          hasPreviousPage,
        },
        filters: {
          action: action || null,
          search: search || null,
          startDate: startDate || null,
          endDate: endDate || null,
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

