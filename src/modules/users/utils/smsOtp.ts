import { FastifyRequest, FastifyReply } from "fastify";
 
import { db } from "../../../models/db.js";
import crypto from "crypto";

import axios from "axios"; 



 // ============================================================
// 🔄 SEND OTP VIA SMS ONLY (USED IN LOGIN & DUAL VERIFICATION) CONTROLLER
// ============================================================

 
export const sendOtp = async (req: FastifyRequest, reply: FastifyReply) => {
    
  const { phone } = req.body as { phone: string };
    console.log(phone,"phone number is")

  if (!phone) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Phone number is required",
      error: "phone_required",
      data: null,
      validation: { error: "phone_required" },
    });
  }

  try {
    const user = await db
      .selectFrom("users")
      .select(["username", "email"])
      .where("phone", "=", phone)
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Mobile number not found",
        error: "user_not_found",
        data: null,
        validation: { error: "user_not_found" },
      });
    }

    // Generate 4 digit OTP
    const otp = crypto.randomInt(1000, 9999).toString();
    console.log("otp",otp)

    // OTP expiry = 5 minutes
    const otpExpireAt = new Date(Date.now() + 5 * 60 * 1000);
    
    // Generate session_id for dual verification
    const session_id = crypto.randomUUID();
    const session_expire_at = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const smsConfig = await db.selectFrom("smsapiparams")
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
        validation: null,
      });
    }

    const smsParams = {
      apikey: smsConfig.apikey,
      type: smsConfig.type || "TEXT",
      sender: smsConfig.sender,
      entityId: smsConfig.entityId,
      templateId: smsConfig.templateId,
      mobile: phone,
      message: `Your Login OTP is ${otp} - 2FA`,
    };

    const fullUrl = `${smsConfig.api_url}?${new URLSearchParams(smsParams)}`;

    let smsResponse;
    try {
      smsResponse = await axios.get(fullUrl);
    } catch (err:any) {
      smsResponse = { data: err.message };
    }
    
 console.log("otp",otp)
    // Save OTP Log with session_id
    await db.insertInto("login_otp_logs")
      .values({
        username: user.username,
        email: user.email,
        mobile: phone,
        otp,
        channel: "sms",
        purpose: "login",
        otp_expire_at: otpExpireAt,
        session_id: session_id,
        session_expire_at: session_expire_at,
        attempts: 0,
        is_used: 0,
        ip_address: req.ip,
        device_info: req.headers["user-agent"] || null,
        api_response: JSON.stringify(smsResponse.data),
        status: "sent",
        created_at: new Date(),
      })
      .execute();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "OTP sent successfully",
      error: null,
      data: { 
        phone,
        session_id: session_id,
        session_expire_at: session_expire_at
      },
      validation: null,
       api_response: JSON.stringify(smsResponse.data),
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


 

// ============================================================
// 🔄 SEND SMS OTP (LEAD MOBILE VERIFICATION ONLY)
// ============================================================
 
export const sendSmsOtpForLead = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  // ✅ username added from body
  const { phone, username } = req.body as {
    phone: string;
    username?: string;
  };

  // 🔴 BASIC VALIDATION
  if (!phone) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Mobile number is required",
      error: "phone_required",
      data: null,
      validation: { phone: "required" },
    });
  }

  // (optional but recommended)
  if (!username) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Username is required",
      error: "username_required",
      data: null,
      validation: { username: "required" },
    });
  }

  try {
    // ============================================================
    // 🔍 STEP 1: CHECK DUPLICATE MOBILE IN LEADS TABLE
    // ============================================================
    const existingLead = await db
      .selectFrom("leads")
      .select(["id"])
      .where("phone", "=", phone)
      .executeTakeFirst();

    if (existingLead) {
      return reply.status(409).send({
        status: 0,
        statuscode: 409,
        message:
          "This mobile number is already registered. Try a different number.",
        error: "mobile_already_exists",
        data: null,
        validation: { phone: "already_exists" },
      });
    }

    // ============================================================
    // 🔐 STEP 2: GENERATE OTP
    // ============================================================
    const otp = crypto.randomInt(1000, 9999).toString();
    const otpExpireAt = new Date(Date.now() + 5 * 60 * 1000);

    // ============================================================
    // 📩 STEP 3: LOAD SMS CONFIG
    // ============================================================
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
        message: "SMS configuration not found",
        error: "sms_config_missing",
        data: null,
        validation: null,
      });
    }

    // ============================================================
    // 📡 STEP 4: SEND OTP VIA SMS API
    // ============================================================
    const smsParams = {
      apikey: smsConfig.apikey,
      type: smsConfig.type || "TEXT",
      sender: smsConfig.sender,
      entityId: smsConfig.entityId,
      templateId: smsConfig.templateId,
      mobile: phone,
      message: `Your verification OTP is ${otp}.`,
    };

    const smsUrl = `${smsConfig.api_url}?${new URLSearchParams(smsParams)}`;

    let smsApiResponse: any = null;
    try {
      const response = await axios.get(smsUrl);
      smsApiResponse = response.data;
    } catch (err: any) {
      smsApiResponse = {
        error: true,
        message: err.message,
      };
    }

    // ============================================================
    // 💾 STEP 5: STORE OTP + USERNAME
    // ============================================================
    await db.insertInto("login_otp_logs").values({
      username,                 // ✅ ADDED
      mobile: phone,
      otp,
      channel: "sms",
      purpose: "lead_verification",
      otp_expire_at: otpExpireAt,
      attempts: 0,
      is_used: 0,
      status: "sent",
      ip_address: req.ip,
      device_info: req.headers["user-agent"] || null,

      api_payload: JSON.stringify(smsParams),
      api_response: JSON.stringify(smsApiResponse),

      created_at: new Date(),
    }).execute();

    // ============================================================
    // ✅ RESPONSE
    // ============================================================
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "OTP sent successfully to your mobile number",
      error: null,
      data: {
        phone,
        otp_expire_at: otpExpireAt,
      },
      validation: null,
    });
  } catch (error) {
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
// ✅ VERIFY SMS OTP (LEAD MOBILE VERIFICATION)
// ============================================================

export const verifySmsOtpForLead = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const { phone, otp } = req.body as {
    phone: string;
    otp: string;
  };

  // 🔴 BASIC VALIDATION
  if (!phone || !otp) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Phone and OTP are required",
      error: "invalid_payload",
      data: null,
      validation: {
        phone: !phone ? "required" : undefined,
        otp: !otp ? "required" : undefined,
      },
    });
  }

  try {
    // ============================================================
    // 🔍 STEP 1: FETCH LATEST UNUSED OTP
    // ============================================================
    const otpRecord = await db
      .selectFrom("login_otp_logs")
      .selectAll()
      .where("mobile", "=", phone)
      .where("otp", "=", otp)
      .where("is_used", "=", 0)
      .where("purpose", "=", "lead_verification")
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
        validation: { otp: "invalid" },
      });
    }

    // ============================================================
    // ⏰ STEP 2: CHECK OTP EXPIRY
    // ============================================================
    if (
      !otpRecord.otp_expire_at ||
      new Date(otpRecord.otp_expire_at) < new Date()
    ) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "OTP expired. Please request a new one.",
        error: "otp_expired",
        data: null,
        validation: { otp: "expired" },
      });
    }

    // ============================================================
    // ✅ STEP 3: MARK OTP AS VERIFIED
    // ============================================================
    await db
      .updateTable("login_otp_logs")
      .set({
        is_used: 1,
        status: "verified",
        used_at: new Date(),
      })
      .where("id", "=", otpRecord.id)
      .execute();

    // ============================================================
    // 🔄 STEP 4 (OPTIONAL BUT RECOMMENDED):
    // MARK LEAD PHONE AS VERIFIED
    // ============================================================
    // await db
    //   .updateTable("leads")
    //   .set({
    //     phone_verified: 1,
    //     updated_at: new Date(),
    //   })
    //   .where("phone", "=", phone)
    //   .execute();

    // ============================================================
    // ✅ RESPONSE
    // ============================================================
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Mobile number verified successfully",
      error: null,
      data: {
        phone,
        verified: true,
      },
      validation: null,
    });
  } catch (error) {
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




