 



import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import crypto from "crypto";
import axios from "axios";
import nodemailer from "nodemailer";

// ============================================================
// 🔄 RESET PASSWORD OTP SEND VIA EMAIL OR MOBILE NUMBER (IDENTIFIRE) CONTROLLER
// ============================================================

// export const resetSendOtp = async (req: FastifyRequest, reply: FastifyReply) => {
//   const { identifier } = req.body as { identifier: string };
//   console.log("identifier",identifier)

//   if (!identifier) {
//     return reply.status(400).send({
//       status: 0,
//       statuscode: 400,
//       message: "Identifier is required",
//       error: "identifier_required",
//       data: null,
//       validation: { error: "identifier_required" },
//     });
//   }

//   // ---------------------------------------------------------
//   // AUTO DETECT METHOD
//   // ---------------------------------------------------------
//   const isEmail = identifier.includes("@");
//   const method: "sms" | "email" = isEmail ? "email" : "sms";

//   try {
//     // Fetch user by email OR phone
//     const user = await db
//       .selectFrom("users")
//       .select(["username", "phone", "email","uuid"])
//       .where(isEmail ? "email" : "phone", "=", identifier)
//       .executeTakeFirst();
      

//     if (!user) {
//       return reply.status(404).send({
//         status: 0,
//         statuscode: 404,
//         message: "User not found",
//         error: "user_not_found",
//         data: null,
//       });
//     }

//     // ---------------------------------------------------------
//     // Generate OTP
//     // ---------------------------------------------------------
//     const otp = crypto.randomInt(1000, 9999).toString();
//     const otpExpireAt = new Date(Date.now() + 5 * 60 * 1000);

//     let apiResponse: any = {};

//     // ---------------------------------------------------------
//     // SEND OTP BY SMS
//     // ---------------------------------------------------------
//     if (method === "sms") {
//       const smsConfig = await db
//         .selectFrom("smsapiparams")
//         .selectAll()
//         .orderBy("id", "desc")
//         .limit(1)
//         .executeTakeFirst();

//       if (!smsConfig) {
//         return reply.status(500).send({
//           status: 0,
//           statuscode: 500,
//           message: "SMS API configuration missing",
//           error: "sms_config_missing",
//           data: null,
//         });
//       }

//       const smsParams = {
//         apikey: smsConfig.apikey,
//         type: smsConfig.type || "TEXT",
//         sender: smsConfig.sender,
//         entityId: smsConfig.entityId,
//         templateId: smsConfig.templateId,
//         mobile: user.phone ?? identifier,
//         message: `Your Reset Password OTP is ${otp} - 2FA`,
//       };

//       const fullUrl = `${smsConfig.api_url}?${new URLSearchParams(smsParams)}`;

//       let smsResponse: any;
//       try {
//         smsResponse = await axios.get(fullUrl);
//       } catch (err: any) {
//         smsResponse = { data: err.message };
//       }

//       apiResponse = smsResponse?.data ?? smsResponse;
//     }

//     // ---------------------------------------------------------
//     // SEND OTP BY EMAIL
//     // ---------------------------------------------------------

//     if (method === "email") {
//   const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
//   const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
//   const smtpSecure = process.env.SMTP_SECURE === "true";
//   const smtpUser = process.env.SMTP_USER;
//   const smtpPass = process.env.SMTP_PASS;
//   const smtpFromName = process.env.SMTP_FROM_NAME || "noreply";
//   const smtpFromEmail = process.env.SMTP_FROM_EMAIL || smtpUser;

//   if (!smtpUser || !smtpPass) {
//     throw new Error("SMTP_USER and SMTP_PASS environment variables are required");
//   }

//   const transporter = nodemailer.createTransport({
//     host: smtpHost,
//     port: smtpPort,
//     secure: smtpSecure,
//     auth: {
//       user: smtpUser,
//       pass: smtpPass,
//     },
//     tls: {
//       rejectUnauthorized: false,
//     },
//   });

//   try {
//     // Test SMTP connection first
//     await transporter.verify();
//     req.log.info("SMTP connection OK");

//     const emailResponse = await transporter.sendMail({
//       from: `"${smtpFromName}" <${smtpFromEmail}>`,
//       to: user.email,
//       subject: "Your Reset Password OTP",
//       html: `<p>Your OTP is <b>${otp}</b></p>`,
//     });

//     apiResponse = emailResponse;
//   } catch (err: any) {
//     req.log.error("EMAIL SEND ERROR:", err);
//     apiResponse = { error: err.message, stack: err };
//   }
// }


//     // ---------------------------------------------------------
//     // SAVE OTP LOG
//     // ---------------------------------------------------------
//     await db
//       .insertInto("reset_password")
//       .values({
//         uuid:user.uuid,
//         username: user.username,
//         email: user.email,
//         mobile: user.phone,
//         otp,
//         channel: method,
//         purpose: "reset_password_otp",
//         otp_expire: otpExpireAt,
//         // attempts: 0,
//         // is_used: 0,
//         ip_address: req.ip,
//         device_info: req.headers["user-agent"] || null,
//         api_response: JSON.stringify(apiResponse),
//         // api_payload:JSON.stringify(samParams),
//         status: "sent",
//         created_at: new Date(),
//       })
//       .execute();

//     return reply.status(200).send({
//       status: 1,
//       statuscode: 200,
//       message: `OTP sent via ${method}`,
//       error: null,
//       data: { identifier, method },
//       api_response: apiResponse,
//     });
//   } catch (error) {
//     req.log.error(error);
//     return reply.status(500).send({
//       status: 0,
//       statuscode: 500,
//       message: "Internal server error",
//       error: "server_error",
//       data: null,
//     });
//   }
// };



 

/**
 * =========================================================
 * 🔐 RESET PASSWORD - SEND OTP
 * - Auto detect SMS / EMAIL
 * - SMS config → smsapiparams table
 * - SMTP config → smtpmailopt table (NO .env)
 * - OTP stored for audit & verification
 * =========================================================
 */
export const resetSendOtp = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const { identifier } = req.body as { identifier: string };

  /* -------------------------------------------------------
   * ❌ Basic validation
   * ------------------------------------------------------- */
  if (!identifier) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Identifier is required",
      error: "identifier_required",
      data: null,
    });
  }

  /* -------------------------------------------------------
   * 🔍 Detect channel (email or sms)
   * ------------------------------------------------------- */
  const isEmail = identifier.includes("@");
  const channel: "sms" | "email" = isEmail ? "email" : "sms";

  try {
    /* -------------------------------------------------------
     * 👤 Fetch user
     * ------------------------------------------------------- */
    const user = await db
      .selectFrom("users")
      .select(["uuid", "username", "phone", "email"])
      .where(isEmail ? "email" : "phone", "=", identifier)
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "user_not_found",
        data: null,
      });
    }

    /* -------------------------------------------------------
     * 🔢 Generate OTP (valid 5 minutes)
     * ------------------------------------------------------- */
    const otp = crypto.randomInt(1000, 9999).toString();
    const otpExpireAt = new Date(Date.now() + 5 * 60 * 1000);
    let apiResponse: any = null;

    /* -------------------------------------------------------
     * 📲 SEND OTP VIA SMS
     * ------------------------------------------------------- */
    if (channel === "sms") {
      const smsConfig = await db
        .selectFrom("smsapiparams")
        .selectAll()
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();

      if (!smsConfig) {
        return reply.status(500).send({
          status: 0,
          statuscode: 500,
          message: "SMS API configuration missing",
          error: "sms_config_missing",
          data: null,
        });
      }

      const smsParams = {
        apikey: smsConfig.apikey,
        type: smsConfig.type || "TEXT",
        sender: smsConfig.sender,
        entityId: smsConfig.entityId,
        templateId: smsConfig.templateId,
        mobile: user.phone ?? identifier,
        message: `Your Reset Password OTP is ${otp}`,
      };

      const smsUrl = `${smsConfig.api_url}?${new URLSearchParams(
        smsParams
      ).toString()}`;

      try {
        const smsResp = await axios.get(smsUrl, { timeout: 10000 });
        apiResponse = smsResp.data;
      } catch (err: any) {
        req.log.error(err, "SMS send failed");
        apiResponse = { error: err.message };
      }
    }

    /* -------------------------------------------------------
     * 📧 SEND OTP VIA EMAIL (SMTP FROM DB)
     * ------------------------------------------------------- */
    if (channel === "email") {
      const smtpConfig = await db
        .selectFrom("smtpmailotp")
        .select([
          "host",
          "port",
          "secure",
          "email",
          "password",
          "sender_name",
        ])
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();

      if (!smtpConfig) {
        return reply.status(500).send({
          status: 0,
          statuscode: 500,
          message: "SMTP configuration missing",
          error: "smtp_config_missing",
          data: null,
        });
      }

      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: Number(smtpConfig.port),
        secure: smtpConfig.secure === 1, // 465 = true, 587 = false
        auth: {
          user: smtpConfig.email,
          pass: smtpConfig.password,
        },
        tls: {
          rejectUnauthorized: false,
        },
      });

      try {
        // ✅ Verify SMTP connection
        await transporter.verify();

        const emailResp = await transporter.sendMail({
          from: `"${smtpConfig.sender_name}" <${smtpConfig.email}>`,
          to: user.email,
          subject: "Reset Password OTP",
          html: `
            <div style="font-family:Arial,sans-serif">
              <h3>Password Reset</h3>
              <p>Your OTP is:</p>
              <h2>${otp}</h2>
              <p>This OTP is valid for 5 minutes.</p>
            </div>
          `,
        });

        apiResponse = emailResp;
      } catch (err: any) {
        req.log.error(err, "Email send failed");
        apiResponse = { error: err.message };
      }
    }

    /* -------------------------------------------------------
     * 📝 Save OTP log (security & audit)
     * ------------------------------------------------------- */
    await db
      .insertInto("reset_password")
      .values({
        uuid: user.uuid,
        username: user.username,
        email: user.email,
        mobile: user.phone,
        otp,
        channel,
        purpose: "reset_password_otp",
        otp_expire: otpExpireAt,
        ip_address: req.ip,
        device_info: req.headers["user-agent"] || null,
        api_response: JSON.stringify(apiResponse),
        status: "sent",
        created_at: new Date(),
      })
      .execute();

    /* -------------------------------------------------------
     * ✅ Success
     * ------------------------------------------------------- */
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: `OTP sent via ${channel}`,
      error: null,
      data: {
        identifier,
        channel,
      },
    });
  } catch (error) {
    req.log.error(error, "RESET OTP ERROR");
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
      data: null,
    });
  }
};
