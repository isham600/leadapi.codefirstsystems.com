import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

// ============================================================
// 🔄 GET LOGIN SESSION CONTROLLER
// ============================================================

export const getLoginSession = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;

    console.log("username in token ", username);

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

    // 🔹 Current token: prefer cookie (actual session), else Authorization header
    const authHeader = (req.headers.authorization ||
      (req.headers as any).Authorization) as string | undefined;
    const cookieToken = (req.cookies as any)?.session_token as
      | string
      | undefined;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    const currentToken = cookieToken || bearerToken;

    // Pagination + search
    const page = Number((req.query as any)?.page) || 1;
    const limit = Number((req.query as any)?.limit) || 10;
    const search = (req.query as any)?.search ?? "";
    const offset = (page - 1) * limit;

    // ⭐ Fetch only ACTIVE sessions
    let query = db
      .selectFrom("session_login")
      .select([
        "id",
        "Ip",
        "deviceInfo",
        "expire_at",
        "is_revoked",
        "last_active_at",
        "session_token", // 👈 add this to compare with currentToken
      ])
      .where("username", "=", username)
      .where("is_revoked", "=", 0);

    // ⭐ Search by expire_at
    if (search.trim() !== "") {
      query = query.where("expire_at", "like", `%${search}%`);
    }

    // Order latest first
    query = query.orderBy("id", "desc");
    console.log("query", query);

    // Apply pagination
    const rows = await query.limit(limit).offset(offset).execute();

    // Total active sessions count
    const totalCount = await db
      .selectFrom("session_login")
      .select(({ fn }) => [fn.count("id").as("count")])
      .where("username", "=", username)
      .where("is_revoked", "=", 0)
      .$if(search.trim() !== "", (q) =>
        q.where("expire_at", "like", `%${search}%`)
      )
      .executeTakeFirst();

    // 🔹 Mark current session row
    const list = rows.map((row: any) => ({
      id: row.id,
      Ip: row.Ip,
      deviceInfo: row.deviceInfo,
      expire_at: row.expire_at,
      is_revoked: row.is_revoked,
      last_active_at: row.last_active_at,
      is_current: currentToken
        ? row.session_token === currentToken ||
          (bearerToken ? row.session_token === bearerToken : false)
        : false,
    }));

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Active sessions fetched successfully",
      error: null,
      validation: null,
      data: {
        list,
        pagination: {
          page,
          limit,
          total: Number(totalCount?.count || 0),
          totalPages: Math.ceil(Number(totalCount?.count || 0) / limit),
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


// ============================================================
// 🔄 UPDATE LOGIN SESSION CONTROLLER
// ============================================================

export const updateLoginSession = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { id } = req.params as { id: string };
    console.log("Session ID:", id);

    if (!id) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Session ID is required",
        error: "missing_id",
        data: null,
      });
    }

    // Expect: { status: "logout" }
    const { status } = req.body as { status: "logout" };
    console.log("Status:", status);

    // Allow only "logout"
    if (status !== "logout") {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Only 'logout' status is allowed",
        error: "invalid_status",
        data: null,
      });
    }

    // Fetch session
    const session = await db
      .selectFrom("session_login")
      .select(["id", "is_revoked"])
      .where("id", "=", id)
      .executeTakeFirst();

    if (!session) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Session not found",
        error: "not_found",
        data: null,
      });
    }

    // Already logged out
    if (session.is_revoked === 1) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Session is already revoked",
        error: "already_revoked",
        data: null,
      });
    }

    // Update to logged out (is_revoked = 1)
    await db
      .updateTable("session_login")
      .set({ is_revoked: 1 })
      .where("id", "=", id)
      .executeTakeFirst();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "User revoked successfully",
      error: null,
      data: {
        id,
        is_revoked: 1,
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
    });
  }
};




// ============================================================
// 🔄 ALL LOGOUT SESSION  CONTROLLER
// ============================================================


export const AllLogoutSession = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;

    console.log("username in token ", username);

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

    // ⭐ Step 1: Fetch all ACTIVE (not revoked) sessions
    const activeSessions = await db
      .selectFrom("session_login")
      .select([
        "id",
        "Ip",
        "deviceInfo",
        "expire_at",
        "is_revoked",
        "last_active_at",
      ])
      .where("username", "=", username)
      .where("is_revoked", "=", 0)
      .execute();

    console.log("Active sessions:", activeSessions);

    if (activeSessions.length === 0) {
      return reply.status(200).send({
        status: 0,
        statuscode: 200,
        message: "No active sessions found",
        error: null,
        validation: null,
      });
    }

    // ⭐ Step 2: Revoke all active sessions
    await db
      .updateTable("session_login")
      .set({
        is_revoked: 1,
        // revoked_at: new Date(), // if your table has this column
      })
      .where("username", "=", username)
      .where("is_revoked", "=", 0)
      .execute();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "All active sessions revoked successfully",
      error: null,
      validation: null,
      data: {
        revoked_count: activeSessions.length,
        revoked_sessions: activeSessions,
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

 