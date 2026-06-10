 import { FastifyRequest, FastifyReply } from "fastify";
 
import { db } from "../../../models/db.js";
import { generateJwtToken } from "../../../plugins/jwt.js";
import { logActivity } from "./logActivity.js";

 
 
 // ============================================================
// 🔄 VERIFY SMS OTP CONTROLLER
// ============================================================


export const verifyOtp = async (req: FastifyRequest, reply: FastifyReply) => {
  const { phone, otp, session_id, verification_type } = req.body as { 
    phone: string; 
    otp: string; 
    session_id?: string;
    verification_type?: string;
  };

  console.log("otp ", otp)

  if (!phone || !otp) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Phone and OTP are required",
      error: "invalid_payload",
      data: null,
      validation: { error: "phone_and_otp_required" },
    });
  }

  try {
    // 🔍 Fetch latest unused OTP for this phone
    let query = db
      .selectFrom("login_otp_logs")
      .selectAll()
      .where("mobile", "=", phone)
      .where("otp", "=", otp)
      .where("is_used", "=", 0)
      .orderBy("id", "desc")
      .limit(1);

    // If session_id is provided (dual verification), check it
    if (session_id && verification_type === "sms_otp") {
      query = query.where("session_id", "=", session_id) as any;
    }

    const otpRecord = await query.executeTakeFirst();

    if (!otpRecord) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Invalid OTP",
        error: "otp_invalid",
        data: null,
        validation: { error: "otp_invalid" },
      });
    }

    console.log("otp",otpRecord)

    // Check session expiry if session_id exists (dual verification)
    if (session_id && otpRecord.session_id) {
      if (!otpRecord.session_expire_at || new Date(otpRecord.session_expire_at) < new Date()) {
        return reply.status(400).send({
          status: 0,
          statuscode: 400,
          message: "Session expired. Please request a new OTP",
          error: "session_expired",
          data: null,
          validation: { error: "session_expired" },
        });
      }
    }


    if (new Date(otpRecord.otp_expire_at) < new Date()) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "OTP expired",
        error: "otp_expired",
        data: null,
        validation: { error: "otp_expired" },
      });
    }

    // 🟩 Mark OTP as verified
    await db
      .updateTable("login_otp_logs")
      .set({ 
        is_used: 1, 
        status: "verified",
        used_at: new Date()
      })
      .where("id", "=", otpRecord.id)
      .execute();
    
    // Clear session_id from login_otp_logs after successful verification (if dual verification)
    if (session_id && otpRecord.session_id) {
      await db
        .updateTable("login_otp_logs")
        .set({
          session_id: null,
          session_expire_at: null,
        })
        .where("id", "=", otpRecord.id)
        .execute();
    }

    // 🔍 Fetch user details (include user_type for token generation)
    const user = await db
      .selectFrom("users")
      .select([
        "id",
        "uuid",
        "firstname",
        "lastname",
        "email",
        "username",
        "phone",
        "user_type", // ✅ Include user_type for role-based access
        "has_dual_verification",
        "dual_verification_type",
        "is_active", // ✅ Include is_active for account status check
      ])
      .where("phone", "=", phone)
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "not_found",
        data: null,
        validation: { error: "not_found" },
      });
    }

    // 🔒 CHECK IF USER ACCOUNT IS ACTIVE
    if (user.is_active !== 1) {
      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: "Your Account is disabled. Please contact administrator.",
        error: "account_disabled",
        data: null,
        validation: { error: "account_disabled" },
      });
    }

    // 🌍 IP + Device Info
    const ip =
      req.ip || req.headers["x-forwarded-for"]?.toString() || "0.0.0.0";

    const deviceInfo = req.headers["user-agent"] || null;

    // 🟩 Update user login info
    await db
      .updateTable("users")
      .set({
        last_login_at: new Date(),
        last_ip: ip,
        device_info: deviceInfo,
      })
      .where("uuid", "=", user.uuid)
      .execute();

    // ---------------------------------------------------------
    // 🔐 Generate SESSION TOKEN (REFRESH TOKEN - 7 days)
    // ---------------------------------------------------------
    const { token: sessionToken } = generateJwtToken({
      uuid: user.uuid,
      id: user.id,
      username: user.username,
      tokenType: "session", // 🔹 refresh token
      expiresIn: "7d",
    });

    // ---------------------------------------------------------
    // 🔐 Generate ACCESS TOKEN (SHORT LIVED - 20 min)
    // ---------------------------------------------------------
    const { token: accessToken } = generateJwtToken({
      uuid: user.uuid,
      id: user.id,
      username: user.username,
      user_type: user.user_type, // ✅ Include user_type for role-based access
      tokenType: "access", // 🔹 access token
      expiresIn: "7d", // 🔹 7 days instead of 20 minutes
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // 🔄 Save session in DB (refresh token stored)
    await db
      .insertInto("session_login")
      .values({
        uuid: user.uuid,
        username: user.username,
        session_token: sessionToken, // 🔹 refresh token stored
        ip: req.ip || null,
        deviceInfo: req.headers["user-agent"] || null,
        expire_at: expiresAt,
        created_at: new Date(),
      })
      .execute();

    // 🍪 Refresh token (long lived - 7 days)
    reply.setCookie("session_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    // 🍪 Access token (short lived - 20 minutes)
    reply.setCookie("access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 🔹 7 days
      path: "/",
    });


    // Log login activity
    await logActivity(req, {
      username: user.username,
      uuid: user.uuid,
      action: "successful_login_with_otp",
      description: `User ${user.username} successfully logged in with OTP | dual_verification=${user.has_dual_verification ? 1 : 0} | dual_type=${user.dual_verification_type || "none"}`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "OTP verified & user logged in",
      error: null,
      data: {
        access_token: accessToken, // Include access token in response for frontend
        id: user.id,
        uuid: user.uuid,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        username: user.username,
        phone: user.phone,
      },
      validation: null,
    });

  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
      data: null,
      validation: { error: "server_error" },
    });
  }
};
