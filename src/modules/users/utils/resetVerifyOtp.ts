
import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import crypto from "crypto";
import { logActivity } from "./logActivity.js";
 

// ============================================================
// 🔄 RESET PASSWORD OTP VERIFY VIA EMAIL / MOBILE NUMBER (IDENTIFIRE) CONTROLLER
// ============================================================

export const resetVerifyOtp = async (req: FastifyRequest, reply: FastifyReply) => {
  const { identifier, otp } = req.body as { identifier: string; otp: string };

  if (!identifier || !otp) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Identifier and OTP are required",
      error: "invalid_payload",
      data: null,
      validation: { error: "identifier_and_otp_required" },
    });
  }

  const isEmail = identifier.includes("@");

  try {
    // -------------------------------------------------------
    // Fetch the latest OTP for this identifier (email or mobile)
    // -------------------------------------------------------
    const otpRecord = await db
      .selectFrom("reset_password")
      .selectAll()
      .where(isEmail ? "email" : "mobile", "=", identifier)
      .where("otp", "=", otp)
      .where("verified", "=", 0)
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();

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

    // -------------------------------------------------------
    // Check OTP expiry
    // -------------------------------------------------------
    if (new Date(otpRecord.otp_expire) < new Date()) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "OTP expired",
        error: "otp_expired",
        data: null,
        validation: { error: "otp_expired" },
      });
    }

    // -------------------------------------------------------
    // Generate session ID for password reset
    // -------------------------------------------------------
    const sessionId = crypto.randomUUID();
    const sessionExpire = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    // const sessionExpire = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes


    // -------------------------------------------------------
    // Update the OTP record → verified + session info
    // -------------------------------------------------------
    await db
      .updateTable("reset_password")
      .set({
        verified: 1,
        session_id: sessionId,
        session_expire: sessionExpire,
        updated_at: new Date(),
      })
      .where("id", "=", otpRecord.id)
      .execute();

    // Log reset password activity
    await logActivity(req, {
      username: identifier,
      uuid: identifier,
      action: "successful_reset_password",
      description: `User ${identifier} successfully reset password`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "OTP verified successfully",
      error: null,
      data: {
        identifier,
        session_id: sessionId,
        session_expire: sessionExpire,
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


 
