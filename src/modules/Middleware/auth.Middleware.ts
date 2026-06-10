// src/middleware/authMiddleware.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../models/db.js";
import jwt from "jsonwebtoken";

type JwtPayload = {
  uuid: string;
  id?: number;
  username?: string;
  // 🔹 ONLY for access token
  user_type?: number;
  token_type?: "access" | "session"; // 🔹 NEW
  iat?: number;
  exp?: number;
};

export const verifyJwt = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const now = new Date();

    /* =========================================================
       1️⃣ ACCESS TOKEN CHECK (PRIMARY)
       ========================================================= */

    let accessToken: string | undefined;

    // 🔹 NEW: access_token cookie se uthao
    if (req.cookies?.access_token) {
      accessToken = req.cookies.access_token as string;
    }

    // 🔹 Authorization header support (primary for API calls)
    if (!accessToken && req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
        accessToken = parts[1];
      }
    }

    if (accessToken) {
      try {
        // 🔹 Try to verify as JWT access token first
        const decoded = jwt.verify(
          accessToken,
          process.env.JWT_SECRET!,
        ) as JwtPayload;
        
        console.log("decode acccess token",decoded)

        // 🔐 Extra safety: token type check
        if (decoded.token_type !== "access") {
          // Not an access token, might be permanent token - fall through to check DB
          throw new Error("not_access_token");
        }

        console.log("decode acccess token",decoded)
         // 🔐 2️⃣ ROLE MUST EXIST

        let userType = decoded.user_type;

        // 🔹 If role missing in token → fetch from DB using uuid
        if (!userType) {
          const userFromDb = await db
            .selectFrom("users")
            .select(["user_type"])
            .where("uuid", "=", decoded.uuid)
            .executeTakeFirst();

          if (!userFromDb || !userFromDb.user_type) {
            return reply.status(401).send({
              status: 0,
              statuscode: 401,
              message: "User role not found",
              error: "role_missing",
              data: null,
              validation: null,
            });
          }

          // 🔒 REMOVED: Account active check - allow impersonated disabled users to access APIs
          // This allows admins to impersonate disabled users and access their data

          userType = userFromDb.user_type;
        }

        // 🔒 REMOVED: Account active check for users with userType in token
        // This allows admins to impersonate disabled users and access their data

        // 🔐 3️⃣ CHECK IF CURRENT SESSION IS REVOKED
        // Get the session token from cookie to verify against DB
        const sessionToken = req.cookies?.session_token as string | undefined;

        if (sessionToken && decoded.username) {
          const sessionRecord = await db
            .selectFrom("session_login")
            .select(["is_revoked", "id"])
            .where("session_token", "=", sessionToken)
            .where("username", "=", decoded.username)
            .executeTakeFirst();

          // If session is revoked → user is logged out from another device
          if (sessionRecord && sessionRecord.is_revoked === 1) {
            return reply.status(401).send({
              status: 0,
              statuscode: 401,
              message: "Session has been revoked. Please login again.",
              error: "session_revoked",
              data: null,
              validation: null,
            });
          }

          // Update last_active_at for this session
          if (sessionRecord) {
            await db
              .updateTable("session_login")
              .set({ last_active_at: new Date() })
              .where("id", "=", sessionRecord.id)
              .execute();
          }
        }

        // ✅ Access token valid → allow request
        req.user = {
          uuid: decoded.uuid,
          id: decoded.id,
          username: decoded.username,
          user_type: userType,
          iat: decoded.iat,
          exp: decoded.exp,
        };

        (req as any).session = null;
        return;
      } catch (err: any) {
        // ⛔ JWT verification failed - token might be a permanent token
        // Check if it's a permanent token in the database
        console.log("JWT verification failed, checking if token is permanent_token:", err.message);
        
        const userByPermanentToken = await db
          .selectFrom("users")
          .select(["uuid", "id", "username", "user_type", "is_active"])
          .where("permanent_token", "=", accessToken)
          .executeTakeFirst();

        if (userByPermanentToken) {
          // 🔒 Check if account is active
          if (userByPermanentToken.is_active !== 1) {
            return reply.status(403).send({
              status: 0,
              statuscode: 403,
              message: "Your Account is disabled. Please contact administrator.",
              error: "account_disabled",
              data: null,
              validation: null,
            });
          }

          // Update last active timestamp
          await db
            .updateTable("users")
            .set({ permanent_token_last_active: now })
            .where("uuid", "=", userByPermanentToken.uuid)
            .execute();

          req.user = {
            uuid: userByPermanentToken.uuid,
            id: userByPermanentToken.id,
            username: userByPermanentToken.username,
            user_type: userByPermanentToken.user_type,
          };

          (req as any).session = null;
          return;
        }

        // Token is neither valid JWT nor permanent token - fall through to check cookies
      }
    }

    /* =========================================================
       2️⃣ PERMANENT TOKEN FALLBACK
       ========================================================= */

    let fallbackToken: string | undefined;

    if (req.cookies?.permanent_token) {
      fallbackToken = req.cookies.permanent_token as string;
    }

    if (!fallbackToken && req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
        fallbackToken = parts[1];
      }
    }

    if (!fallbackToken) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Token missing",
        error: "token_missing",
        data: null,
        validation: null,
      });
    }

    // 🔹 Permanent token DB check
    const user = await db
      .selectFrom("users")
      .select(["uuid", "id", "username", "user_type", "is_active"])
      .where("permanent_token", "=", fallbackToken)
      .executeTakeFirst();

    if (user) {
      // 🔒 Check if user account is active
      if (user.is_active !== 1) {
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: "Your Account is disabled. Please contact administrator.",
          error: "account_disabled",
          data: null,
          validation: null,
        });
      }

      await db
        .updateTable("users")
        .set({ permanent_token_last_active: now })
        .where("uuid", "=", user.uuid)
        .execute();

      req.user = {
        uuid: user.uuid,
        id: user.id,
        username: user.username,
        user_type: user.user_type,
      };

      (req as any).session = null;
      return;
    }

    /* =========================================================
       3️⃣ NO VALID TOKEN
       ========================================================= */

    return reply.status(401).send({
      status: 0,
      statuscode: 401,
      message: "Unauthorized",
      error: "unauthorized",
      data: null,
      validation: null,
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
      data: null,
      validation: null,
    });
  }
};
