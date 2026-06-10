import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import crypto from "crypto";
import nodemailer from "nodemailer";



// ============================================================
// 🔄 SEND OTP VIA EMAIL ONLY (USED IN DUAL VERIFICATION) CONTROLLER
// ============================================================

export const SendOtpEmail = async (req: FastifyRequest, reply: FastifyReply) => {
  const { email } = req.body as { email: string };
  console.log("identifier", email);

  if (!email) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Email is required",
      error: "email_required",
      data: null,
    });
  }

  try {
    // ---------------------------------------------------------
    // Always check user by email only (sms removed)
    // ---------------------------------------------------------
    const user = await db
      .selectFrom("users")
      .select(["username", "phone", "email", "uuid"])
      .where("email", "=", email)
      .executeTakeFirst();

    console.log("user", user);

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "user_not_found",
        data: null,
      });
    }

    // ---------------------------------------------------------
    // Generate OTP
    // ---------------------------------------------------------
    const otp = crypto.randomInt(1000, 9999).toString();
    const otpExpireAt = new Date(Date.now() + 5 * 60 * 1000);
    
    // Generate session_id for dual verification
    const session_id = crypto.randomUUID();
    const session_expire_at = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    let apiResponse: any = {};

    // ---------------------------------------------------------
    // SEND OTP **ONLY VIA EMAIL**
    // ---------------------------------------------------------
    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
    const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
    const smtpSecure = process.env.SMTP_SECURE === "true";
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFromName = process.env.SMTP_FROM_NAME || "noreply";
    const smtpFromEmail = process.env.SMTP_FROM_EMAIL || smtpUser;

    if (!smtpUser || !smtpPass) {
      throw new Error("SMTP_USER and SMTP_PASS environment variables are required");
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    try {
      await transporter.verify();
      req.log.info("SMTP connection OK");

      const emailResponse = await transporter.sendMail({
        from: `"${smtpFromName}" <${smtpFromEmail}>`,
        to: user.email,
        subject: "Your login Password OTP",
        html: `<p>Your OTP is <b>${otp}</b></p>`,
      });

      apiResponse = emailResponse;
    } catch (err: any) {
      req.log.error({ err }, "EMAIL SEND ERROR:");
      apiResponse = { error: err.message, stack: err };
    }

    // ---------------------------------------------------------
    // SAVE OTP LOG IN DB with session_id
    // ---------------------------------------------------------
    await db
      .insertInto("login_otp_logs")
      .values({
      //   uuid: user.uuid,
        username: user.username,
        email: user.email,
        mobile: user.phone,
        otp,
        channel: "email",
        otp_expire_at: otpExpireAt,
        session_id: session_id,
        session_expire_at: session_expire_at,
        api_response: JSON.stringify(apiResponse),
        created_at: new Date(),
      })
      .execute();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "OTP sent via email",
      data: { 
        email, 
        method: "email",
        session_id: session_id,
        session_expire_at: session_expire_at
      },
      api_response: apiResponse,
    });
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
      data: null,
    });
  }
};
