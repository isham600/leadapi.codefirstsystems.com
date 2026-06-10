 import { FastifyRequest, FastifyReply } from "fastify";
 
import bcrypt from "bcryptjs";
import { db } from "../../../models/db.js";
import crypto from "crypto";
import { logActivity } from "./logActivity.js";


// ============================================================
// 🔄 RESET PASSWORD  CONTROLLER
// ============================================================

export const resetPassword = async (req: FastifyRequest, reply: FastifyReply) => {
  const { identifier, session_id, new_password } = req.body as {
    identifier: string;
    session_id: string;
    new_password: string;
  };
  console.log(identifier,session_id,new_password)

  // basic validation
  if (!identifier || !session_id || !new_password) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Identifier, session_id and new_password are required",
      error: "invalid_payload",
    });
  }

  if (new_password.length < 8) {
    return reply.status(422).send({
      status: 0,
      statuscode: 422,
      message: "Password must be at least 8 characters long",
      error: "weak_password",
    });
  }

  try {
    // find the reset_password row matching the identifier & session_id
    const isEmail = identifier.includes("@");

    const resetRow = await db
      .selectFrom("reset_password")
      .selectAll()
      .where(isEmail ? "email" : "mobile", "=", identifier)
      .where("session_id", "=", session_id)
      .where("verified", "=", 1) // OTP verified earlier
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!resetRow) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Invalid or missing session token",
        error: "invalid_session",
      });
    }

    // check expiry
    if (!resetRow.session_expire || new Date(resetRow.session_expire) < new Date()) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Session expired",
        error: "session_expired",
      });
    }

    // OPTIONAL: check single-use marker (you can use another column like used = 0/1)
    if ((resetRow.used && resetRow.used === 1) || resetRow.session_used === 1) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Session already used",
        error: "session_used",
      });
    }

    // fetch user to use for password update + session cleanup
    const userRecord = await db
      .selectFrom("users")
      .select(["id", "uuid", "username", "email", "phone"])
      .where(isEmail ? "email" : "phone", "=", identifier)
      .executeTakeFirst();

    if (!userRecord) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found for provided identifier",
        error: "user_not_found",
      });
    }

    // Hash new password
    const hashed = await bcrypt.hash(new_password, 10);

    // Update user's password (assuming users table has email OR mobile column to identify)
    // adjust where clause to match your schema (email OR mobile or username)
    const updateUser = await db
      .updateTable("users")
      .set({
        password_hash: hashed,
        updated_at: new Date(),
      })
      .where(isEmail ? "email" : "phone", "=", identifier)
      .execute();

    // revoke every active session for this user (logout all devices)
    const sessionUsernameRow = await db
      .selectFrom("session_login")
      .select("username")
      .where("uuid", "=", userRecord.uuid)
      .orderBy("id", "desc")
      .executeTakeFirst();

    const usernameFromSession =
      sessionUsernameRow?.username || userRecord.username || null;

    const revokePayload = {
      expire_at: new Date(),
      is_revoked: 1,
    };

    await db
      .updateTable("session_login")
      .set(revokePayload)
      .where("uuid", "=", userRecord.uuid)
      .execute();

    if (usernameFromSession) {
      await db
        .updateTable("session_login")
        .set(revokePayload)
        .where("username", "=", usernameFromSession)
        .execute();
    }

    // Invalidate the reset session — mark used and remove session_id
    await db
      .updateTable("reset_password")
      .set({
        session_id: null,
        session_expire: new Date(),
        // used: 1,          // if you have this column
        verified: 2,      // optional: 2 = used/completed
        updated_at: new Date(),
      })
      .where("id", "=", resetRow.id)
      .execute();

    // Log reset password activity
    await logActivity(req, {
      username: userRecord.username || null,
      uuid: userRecord.uuid || null,
      action: "reset_password",
      description: `User ${userRecord.username || userRecord.email || userRecord.phone} reset password via ${isEmail ? "email" : "phone"}`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Password reset successful",
      data: null,
    });

  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error",
      error: "server_error",
    });
  }
};
