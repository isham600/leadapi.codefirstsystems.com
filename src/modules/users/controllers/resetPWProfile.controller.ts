import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import bcrypt from "bcryptjs";
import { logActivity } from "../utils/logActivity.js";


// ============================================================
// 🔄 CHANGE PASSWORD FORM DASHBOARD CONTROLLER
// ============================================================


export const changePasswordDashboard = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    // ---- 1) Read UUID from token (set by verifyJwt middleware)
    const uuid = (req as any).user?.uuid;
    console.log("uuid",uuid)

    if (!uuid) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Invalid token",
        error: "invalid_token",
        data: null,
        validation: null,
      });
    }

    // ---- 2) Read new password from body
    const {current_password, new_password } = req.body as any;
  
    if (!current_password) {
      return reply.status(422).send({
        status: 0,
        statuscode: 422,
        message: "Current password is required",
        error: "validation_error",
        data: null,
        validation: { current_password: "Required" },
      });
    }

  const dbUser = await db
    .selectFrom("users")
    .select(["password_hash"])
    .where("uuid", "=", uuid)
    .executeTakeFirst();

    if (!dbUser) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "user_not_found",
        data: null,
        validation: null,
      });
    }

    const isPasswordValid = await bcrypt.compare(current_password, dbUser.password_hash);

    if (!isPasswordValid) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Invalid current password",
        error: "invalid_current_password",
        data: null,
        validation: null,
      });
    }


    console.log("new pw",new_password )

    if (!new_password) {
      return reply.status(422).send({
        status: 0,
        statuscode: 422,
        message: "New password is required",
        error: "validation_error",
        data: null,
        validation: { new_password: "Required" },
      });
    }

    // ---- 3) Hash password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // ---- 4) Update user table
    const updated = await db
      .updateTable("users")
      .set({ password_hash: hashedPassword ,
        updated_at: new Date(),})
      .where("uuid", "=", uuid)
      .executeTakeFirst();

    // Get username for logging
    const user = await db
      .selectFrom("users")
      .select(["username"])
      .where("uuid", "=", uuid)
      .executeTakeFirst();

    // Log change password activity
    await logActivity(req, {
      username: user?.username || null,
      uuid: uuid,
      action: "change_password",
      description: `User ${user?.username || "unknown"} changed password from dashboard`,
    });

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "Password updated successfully",
      error: null,
      data: null,
      validation: null,
    });

  } catch (err) {
    console.log("Error updating password:", err);
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
