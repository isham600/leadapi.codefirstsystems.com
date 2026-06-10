import { FastifyRequest, FastifyReply } from "fastify";

import { db } from "../../../models/db.js";

import { logActivity } from "../utils/logActivity.js";

import { generateJwtToken } from "../../../plugins/jwt.js";

// ---------------------enablePhoneDualVerification  CONTROLLER-----------------------------

// ---------------------ENABLE PHONE CONTROLLER-----------------------------
export const enablePhoneDualVerification = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // Extract username & uuid from JWT (set by middleware)
    const username = req.user?.username;
    const uuid = req.user?.uuid;

    console.log(
      "username and uuid in enablePhoneDualVerification",
      username,
      uuid
    );
    console.log("req.user in enablePhoneDualVerification", req.user);

    if (!username || !uuid) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - Missing username/uuid in token",
        error: "token_invalid",
        data: null,
        validation: null,
      });
    }

    const updated = await db
      .updateTable("users")
      .set({
        is_phone_verified: 1,
        // has_dual_verification: 1,
        dual_verification_type: "sms_otp",
        dual_verified_at: new Date(),
        updated_at: new Date(),
      })
      .where("username", "=", username)
      .where("uuid", "=", uuid)
      .executeTakeFirst();

    // Log dual verification phone enable activity
    await logActivity(req, {
      username,
      uuid,
      action: "dual_verification_phone",
      description: `User ${username} enabled phone dual verification (SMS OTP)`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Phone dual verification enabled successfully",
      error: null,
      data: {
        username,
        uuid,
        dual_verification_type: "sms_otp",
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
      validation: null,
    });
  }
};


 
 


// ---------------------ENABLE EMAIL CONTROLLER-----------------------------
export const enableEmailDualVerification = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // Extract username & uuid from token
    const username = req.user?.username;
    const uuid = req.user?.uuid;

    if (!username || !uuid) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - Missing username/uuid in token",
        error: "token_invalid",
        data: null,
        validation: null,
      });
    }

    const updated = await db
      .updateTable("users")
      .set({
        is_email_verified: 1,
        // has_dual_verification: 1,
        dual_verification_type: "email_otp",
        dual_verified_at: new Date(),
        updated_at: new Date(),
      })
      .where("username", "=", username)
      .where("uuid", "=", uuid)
      .executeTakeFirst();

    // Log dual verification email enable activity
    await logActivity(req, {
      username,
      uuid,
      action: "dual_verification_email",
      description: `User ${username} enabled email dual verification (Email OTP)`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Email dual verification enabled successfully",
      error: null,
      data: {
        username,
        uuid,
        dual_verification_type: "email_otp",
        dual_verified_at: new Date(),
        updated_at: new Date(),
        is_email_verified: 1,
        // has_dual_verification: 1,
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
      validation: null,
    });
  }
};

 
// ---------------------ENABLE QA CONTROLLER-----------------------------
export const enableQADualVerification = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // -----------------------------------------
    // ✔ Get username & uuid from JWT
    // -----------------------------------------
    const username = req.user?.username;
    const uuid = req.user?.uuid;

    console.log(
      "username and uuid in enableQADualVerification",
      username,
      uuid
    );
    console.log("req.user in enableQADualVerification", req.user);
    if (!username || !uuid) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - Invalid Token",
        error: "token_invalid",
        data: null,
        validation: null,
      });
    }

    // -----------------------------------------
    // ✔ Get question & answer from body
    // -----------------------------------------
    const { question, answer } = req.body as {
      question: string;
      answer: string;
    };
    console.log(
      "question and answer in enableQADualVerification",
      question,
      answer
    );

    if (!question || !answer) {
      return reply.status(422).send({
        status: 0,
        statuscode: 422,
        message: "Question and answer are required",
        error: "validation_error",
        data: null,
        validation: null,
      });
    }

    // -----------------------------------------
    // ✔ Encrypt answer
    // -----------------------------------------
    // const encryptedAnswer = encrypt(answer);

    // console.log("encryptedAnswer",encryptedAnswer)

    // -----------------------------------------
    // ✔ Update user table
    // -----------------------------------------
    const updated = await db
      .updateTable("users")
      .set({
        question: question,
        answer: answer,
        // has_dual_verification: 1,
        dual_verification_type: "qa",
        dual_verified_at: new Date(),
        updated_at: new Date(),
      })
      .where("username", "=", username)
      .where("uuid", "=", uuid)
      .executeTakeFirst();

    // Log dual verification QA enable activity
    await logActivity(req, {
      username,
      uuid,
      action: "dual_verification_qa",
      description: `User ${username} enabled QA (Question-Answer) dual verification`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "QA dual verification enabled successfully",
      error: null,
      data: {
        username,
        uuid,
        dual_verification_type: "qa",
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
      validation: null,
    });
  }
};

// ---------------------ENABLE DUAL VERIFICATION  CONTROLLER-----------------------------

export const enableDualVerification = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // Extract username & uuid from token
    const username = req.user?.username;
    const uuid = req.user?.uuid;

    if (!username || !uuid) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - Missing username/uuid in token",
        error: "token_invalid",
        data: null,
        validation: null,
      });
    }

    const updated = await db
      .updateTable("users")
      .set({
        has_dual_verification: 1,
        dual_verification_type: "sms_otp",
        dual_verified_at: new Date(),
        updated_at: new Date(),
      })
      .where("username", "=", username)
      .where("uuid", "=", uuid)
      .executeTakeFirst();

    // Log dual verification enable activity
    await logActivity(req, {
      username,
      uuid,
      action: "dual_verification_enable",
      description: `User ${username} enabled dual verification`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "dual verification enabled successfully",
      error: null,
      data: {
        username,
        uuid,
        dual_verification_type: "sms_otp",
        dual_verified_at: new Date(),
        updated_at: new Date(),
        is_phone_verified: 1,
        has_dual_verification: 1,
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
      validation: null,
    });
  }
};

// ---------------------DISABLE  DUAL VERIFICATION  CONTROLLER-----------------------------

export const disableDualVerification = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // Extract username & uuid from token
    const username = req.user?.username;
    const uuid = req.user?.uuid;

    if (!username || !uuid) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - Missing username/uuid in token",
        error: "token_invalid",
        data: null,
        validation: null,
      });
    }

    const updated = await db
      .updateTable("users")
      .set({
        has_dual_verification: 0,
        is_phone_verified: 0,
        is_email_verified: 0,
        answer: null,
        question: null,
        dual_verification_type: "none",

        updated_at: new Date(),
      })
      .where("username", "=", username)
      .where("uuid", "=", uuid)
      .executeTakeFirst();

    // Log dual verification disable activity
    await logActivity(req, {
      username,
      uuid,
      action: "dual_verification_disable",
      description: `User ${username} disabled dual verification`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "dual verification disable successfully",
      error: null,
      data: {
        username,
        uuid,
        dual_verification_type: "none",

        updated_at: new Date(),
        is_phone_verified: 0,
        has_dual_verification: 0,

        is_email_verified: 0,
        answer: null,
        question: null,
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
      validation: null,
    });
  }
};



// ============================================================
// 🔄  VERIFY QA CONTROLLER
// ============================================================

export const verifyQA = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    // -------------------------------------------------------
    // ✔ Get question, answer, and session_id from body
    // -------------------------------------------------------
    const { question, answer, session_id, verification_type } = req.body as {
      question: string;
      answer: string;
      session_id?: string;
      verification_type?: string;
    };

    if (!question || !answer) {
      return reply.status(422).send({
        status: 0,
        statuscode: 422,
        message: "Question and answer are required",
        error: "validation_error",
        data: null,
      });
    }

    if (!session_id) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Session ID is required",
        error: "session_id_required",
        data: null,
      });
    }

    // -------------------------------------------------------
    // ✔ Find the user in database with session_id check
    // -------------------------------------------------------
    const user = await db
      .selectFrom("users")
      .select([
        "id",
        "uuid",
        "username",
        "question",
        "answer",
        "firstname",
        "lastname",
        "email",
        "phone",
        "user_type", // ✅ Include user_type for role-based access
        "session_id",
        "session_expire_at",
        "has_dual_verification",
        "dual_verification_type",
      ])
      .where("session_id", "=", session_id)
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Session not found or invalid",
        error: "session_not_found",
        data: null,
      });
    }

    // Check session expiry
    if (
      !user.session_expire_at ||
      new Date(user.session_expire_at) < new Date()
    ) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Session expired. Please login again",
        error: "session_expired",
        data: null,
      });
    }

    // -------------------------------------------------------
    // ❌ Check mismatch
    // -------------------------------------------------------
    if (user.question !== question || user.answer !== answer) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Incorrect 2FA answer",
        error: "invalid_answer",
        data: null,
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
        // session_id: null, // Clear session after successful verification
        // session_expire_at: null,
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
    // 🔐 Generate ACCESS TOKEN (LONG LIVED - 7 days)
    // ---------------------------------------------------------
    const { token: accessToken } = generateJwtToken({
      uuid: user.uuid,
      id: user.id,
      username: user.username,
      user_type: user.user_type, // ✅ Include user_type for role-based access
      tokenType: "access", // 🔹 access token
      expiresIn: "7d", // 🔹 7 days instead of 20 minutes
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Save session in DB (refresh token stored)
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

    // 🍪 Access token (long lived - 7 days)
    reply.setCookie("access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 🔹 7 days
      path: "/",
    });

    // Log dual verification QA verification activity
    await logActivity(req, {
      username: user.username,
      uuid: user.uuid,
      action: "successful_login_with_dual_verification_qa ",
      description: `User ${
        user.username
      } successfully logged in with dual verification (QA) | dual_verification=${
        user.has_dual_verification ? 1 : 0
      } | dual_type=${user.dual_verification_type || "none"}`,
    });

    // -------------------------------------------------------
    // ✔ Everything OK → QA Verified
    // -------------------------------------------------------
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "2AF question verified successfully",
      error: null,
      data: {
        access_token: accessToken, // Include access token in response for frontend
        id: user.id,
        uuid: user.uuid,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phone: user.phone,
        username: user.username,
      },
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




// ============================================================
// 🔄 GET ALL QUESTIONS CONTROLLER
// ============================================================

export const getAllQuestions = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // Fetch all active questions
    const questions = await db
      .selectFrom("question_table")
      .select(["question_text", "is_active", "created_at", "updated_at"])
      .where("is_active", "=", 1)
      .orderBy("created_at", "asc")
      .execute();

    if (!questions || questions.length === 0) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "No questions found",
        error: "not_found",
        data: null,
        validation: null,
      });
    }

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Questions fetched successfully",
      error: null,
      validation: null,
      data: questions,
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
