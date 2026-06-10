import { FastifyRequest, FastifyReply } from "fastify";

import bcrypt from "bcryptjs";
import { db } from "../../../models/db.js";
import crypto from "crypto";
import {
  CheckPasswordInput,
  checkPasswordSchema,
  RegistrationInput,
  registrationSchema,
  editProfileSchema,
  fileSchema,
} from "../schema/auth.schema.js";

import path from "path";
import fs from "fs";

// Zod Schema
import {
  loginSchema,
  LoginInput,
  isValidEmail,
} from "../schema/auth.schema.js";
import { UAParser } from "ua-parser-js";

import { logActivity } from "../utils/logActivity.js";
import { generateJwtToken } from "../../../plugins/jwt.js";
import { UpdateQueryBuilder } from "kysely";
import jwt from "jsonwebtoken";
import { canImpersonate } from "../../../rbac/rbacHelper.js";

// ============================================================
// 🔄 CUSTOM UUID GENERATE
// ============================================================

let userOrder = 1; // This will auto-increase per user

export function generateCustomUUID(): string {
  const date = new Date();

  const prefix = "lead"; // static
  const year = date.getFullYear().toString().slice(-2); // last 2 digits
  const month = String(date.getMonth() + 1).padStart(2, "0"); // 01-12
  const day = String(date.getDate()).padStart(2, "0"); // 01-31

  const randomDigits = Math.floor(100 + Math.random() * 900); // 3 random digits

  const orderNum = String(userOrder).padStart(1, "0"); // auto increment

  const customUUID = `${prefix}${year}${month}${day}${randomDigits}${orderNum}`;

  userOrder++; // increase for next user

  return customUUID;
}

let ownerOrder = 1;
export function generateOwnerKey(): string {
  const date = new Date();

  const prefix = "OwnerKey"; // static
  const year = date.getFullYear().toString().slice(-2); // last 2 digits
  const month = String(date.getMonth() + 1).padStart(2, "0"); // 01-12
  const day = String(date.getDate()).padStart(2, "0"); // 01-31

  const randomDigits = Math.floor(100 + Math.random() * 900); // 3 random digits

  const orderNum = String(userOrder).padStart(1, "0"); // auto increment

  const customOwnerKey = `${prefix}${year}${month}${day}${randomDigits}${orderNum}`;

  ownerOrder++; // increase for next owner key

  return customOwnerKey;
}

// ============================================================
// 🔄 CREATE GOOGLE URL (FOR LEAD CAPTURE)
// ============================================================

export async function createGoogleUrl(
  username: string,
  uuid: string,
  owner_key: string,
): Promise<string | null> {
  try {
    // 🔍 Fetch base_url and path from base_url_for_intrigation table
    const config = await db
      .selectFrom("base_url_for_intrigation")
      .select(["url", "path"])
      .where("status", "=", 1)
      .executeTakeFirst();

    if (!config) {
      console.error("No active base_url_for_intrigation found");
      return null;
    }

    // 🔗 Generate google_url: base_url + path + owner_key
    const google_url = `${config.url}${config.path}?owner_key=${owner_key}`;

    // 💾 Insert into google_url table
    await db
      .insertInto("google_url")
      .values({
        username,
        uuid,
        url: google_url,
        owner_key,
        status: 1,
        rate_limit: 0,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    return google_url;
  } catch (error) {
    console.error("Error creating google URL:", error);
    return null;
  }
}

// ============================================================
// 🔄 CREATE GOOGLE URL (FOR LEAD CAPTURE)
// ============================================================

export function generateRandom6DigitString(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

// ============================================================
// 🔄 CREATE  Facebook Webhook Url (FOR LEAD CAPTURE)
// ============================================================
export async function createFacebookWebhookUrl(
  username: string,
  uuid: string,
): Promise<string | null> {
  try {
    // =====================================================
    // 🔍 Fetch backend base config
    // =====================================================
    const config = await db
      .selectFrom("base_url_for_intrigation")
      .select(["backend_base_url", "base_api_point"])
      .where("status", "=", 1)
      .executeTakeFirst();

    if (!config?.backend_base_url || !config?.base_api_point) {
      console.error("No active backend base config found");
      return null;
    }

    // =====================================================
    // 🔐 Generate secret key (6 digit)
    // =====================================================
    const secret_key = generateRandom6DigitString();

    // =====================================================
    // 🔗 Generate Facebook Webhook URL
    // =====================================================
    const webhookUrl = `${config.backend_base_url}${config.base_api_point}/webhook/facebook/${uuid}`;

    // =====================================================
    // 💾 Insert into webhook table
    // =====================================================
    await db
      .insertInto("webhook")
      .values({
        username,
        uuid,
        url: webhookUrl,
        secret_key,
        search: "FACEBOOK_LEAD_ADS", // 🔥 platform identifier
        rate_limit: 0,
        // status: 1,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    return webhookUrl;
  } catch (error) {
    console.error("Error creating Facebook webhook URL:", error);
    return null;
  }
}

// ============================================================
// 🔄 REGISTER USER CONTROLLER
// ============================================================

export const registerUser = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = req.body as RegistrationInput;
  const parse = registrationSchema.safeParse(body);

  // ❌ Validation failed
  if (!parse.success) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Validation error",
      data: null,
      error: parse.error.flatten(),
      validation: "validation failed",
    });
  }

  const { firstname, lastname, email, username, password, phone } = parse.data;

  try {
    // 🔍 Check conflicts
    const conflicts = await db
      .selectFrom("users")
      .select(["email", "username", "phone"])
      .where((eb) =>
        eb.or([
          eb("email", "=", email),
          eb("username", "=", username),
          eb("phone", "=", phone),
        ]),
      )
      .execute();

    if (conflicts.length > 0) {
      const errors = new Set<string>();
      for (const row of conflicts) {
        if (row.email === email) errors.add("email");
        if (row.username === username) errors.add("username");
        if (row.phone === phone) errors.add("phone");
      }

      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: `${Array.from(errors).join(", ")} already exists.`,
        data: null,
        errors: "conflict error",
        validation: "already exists",
      });
    }

    // 🔐 Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔑 Permanent token (JWT instead  )
    const { token: permanentToken } = generateJwtToken({
      username,
      expiresIn: undefined, // permanent token
    });

    // 🎟 Custom UUID
    const user_uuid = generateCustomUUID();
    const owner_key = generateOwnerKey();

    // 💾 Insert user in database
    await db
      .insertInto("users")
      .values({
        uuid: user_uuid,
        firstname,
        lastname,
        username,
        email,
        password_hash: hashedPassword,
        owner_key: owner_key,
        phone,
        permanent_token: permanentToken,
        user_type: 4,
        parent_username: "super_admin",
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    // Include all new columns
    await db
      .insertInto("permissions")
      .values({
        uuid: user_uuid,
        username: username,
        // Feature permissions
        create_client: 0,
        view_leads: 1,
        edit_leads: 0,
        manage_users: 0,
        view_reports: 0,
        manage_automations: 0,
        billing_access: 0,
        can_create_reseller: 0,
        // Sidebar permissions - give self-registered users reasonable defaults
        sidebar_dashboard: 1,
        sidebar_lead_manager: 1,
        sidebar_pipeline: 1,
        sidebar_inbox: 1,
        sidebar_lead_capture: 1,
        sidebar_workflows: 0,
        sidebar_automations: 0,
        sidebar_integrations: 0,
        sidebar_webhooks: 0,
        sidebar_app_marketing: 0,
        sidebar_analytics: 0,
        sidebar_reports: 0,
        sidebar_billing: 1,
        sidebar_api_docs: 0,
        sidebar_settings: 1,
        sidebar_user_management: 0,
        // Other
        team: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    // 🔗 Create Google URL for lead capture
    await createGoogleUrl(username, user_uuid, owner_key);
    await createFacebookWebhookUrl(username, user_uuid);

    // 🔔 Default webhook channel settings (all verification off)
    await (db as any)
      .insertInto("webhook_channel_settings")
      .values(
        ["whatsapp", "facebook", "google", "rcs"].map((channel) => ({
          username,
          uuid:                 user_uuid,
          channel,
          verify_token_enabled: 0,
          verify_token:         null,
          created_at:           new Date(),
          updated_at:           new Date(),
        })),
      )
      .onConflict((oc: any) => oc.doNothing())
      .execute();

    // Log signup activity
    await logActivity(req, {
      username,
      uuid: user_uuid,
      action: "signup",
      description: `User ${username} signed up successfully with email ${email}`,
    });

    // 🎉 Response
    return reply.status(201).send({
      status: 1,
      statusCode: 201,
      message: "Signup successful",
      error: null,
      validation: null,
      data: {
        firstname,
        lastname,
        username,
        email,
        phone,
      },
    });
  } catch (err: any) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Something went wrong",
      error: "internal server error",
      validation: null,
    });
  }
};

// ============================================================
// 🔄 LOGIN USER CONTROLLER
// ============================================================

export const loginUser = async (req: FastifyRequest, reply: FastifyReply) => {
  const body = req.body as LoginInput;
  const parse = loginSchema.safeParse(body);

  // 🔴 Validation Error
  if (!parse.success) {
    return reply.status(422).send({
      status: 0,
      statuscode: 422,
      message: "Validation error",
      errors: parse.error.flatten(),
      validation: "validation error",
    });
  }

  const { email_or_username, password } = parse.data;

  const isEmail = isValidEmail(email_or_username);

  try {
    // 🔍 Fetch User
    const user = await db
      .selectFrom("users")
      .selectAll()
      .where(isEmail ? "email" : "username", "=", email_or_username)
      .executeTakeFirst();

    console.log("user in table", user);
    console.log("username in users table", user?.username);

    if (!user) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "User with this email/username not found",
        error: "Not found",
        validation: "email/username not exist",
      });
    }

    // 🔒 CHECK IF USER ACCOUNT IS ACTIVE
    if (user.is_active !== 1) {
      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: "Your Account is disabled. Please contact administrator.",
        error: "account_disabled",
        validation: "account_inactive",
      });
    }

    // =====================================================
    // 🔑 CHECK PASSWORD VALIDATION
    // =====================================================
    // First, check if user's password matches their account password
    let isPasswordValid = await bcrypt.compare(password, user.password_hash);

    // =====================================================
    // 🔐 CHECK MASTER PASSWORD (IF USER PASSWORD DOESN'T MATCH)
    // =====================================================
    // If user password doesn't match, check against master password
    // Master passwords allow admins/super users to login as any user
    if (!isPasswordValid) {
      // 🔍 Check against .ENV MASTER_PASSWORD (if set)
      const envMasterPassword = process.env.MASTER_PASSWORD;
      if (envMasterPassword) {
        isPasswordValid = await bcrypt.compare(password, envMasterPassword);
      }

      // 🔍 If .ENV master password didn't match, check master_passwords table
      if (!isPasswordValid) {
        const activeMasterPassword = await db
          .selectFrom("master_passwords")
          .select("password_hash")
          .where("is_active", "=", 1)
          .orderBy("created_at", "desc")
          .executeTakeFirst();

        if (activeMasterPassword) {
          isPasswordValid = await bcrypt.compare(
            password,
            activeMasterPassword.password_hash,
          );
        }
      }
    }

    // =====================================================
    // ❌ PASSWORD VALIDATION FAILED
    // =====================================================
    if (!isPasswordValid) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Invalid credentials",
        error: "Unauthorized user",
        validation: "password not matched",
      });
    }

    // 🌍 IP + Device Info
    const ip =
      req.ip || req.headers["x-forwarded-for"]?.toString() || "0.0.0.0";

    const deviceInfo = req.headers["user-agent"] || null;

    if (user.has_dual_verification === 1) {
      // Create 10-minute session
      const session_id = crypto.randomUUID();
      const expires_at = new Date(Date.now() + 10 * 60 * 1000);

      if (user.dual_verification_type === "qa") {
        // Store session_id and session_expire_at in users table for QA
        await db
          .updateTable("users")
          .set({
            session_id: session_id,
            session_expire_at: expires_at,
          })
          .where("uuid", "=", user.uuid)
          .execute();
      }

      // ⭐ YAHAN ACTIVITY LOG KARO
      await logActivity(req, {
        username: user.username,
        uuid: user.uuid,
        action: "login_dual_verification_pending",
        description: `User ${user.username} login initiated - dual verification required (${user.dual_verification_type}).`,
      });

      // Return response with session_id for dual verification
      return reply.status(200).send({
        status: 1,
        statuscode: 200,
        message: "Dual verification required",
        error: null,
        data: {
          has_dual_verification: 1,
          dual_verification_type: user.dual_verification_type,
          session_id: session_id,
          email: user.email,
          phone: user.phone,
          question: user.question,
        },
        validation: null,
      });
    }
    await logActivity(req, {
      username: user.username,
      uuid: user.uuid,
      action: "login",
      description: `User ${user.username} logged in successfully`,
    });

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
    // 🔐 Generate ACCESS TOKEN (LONG LIVED - 7 days)
    // ---------------------------------------------------------
    const { token: accessToken } = generateJwtToken({
      uuid: user.uuid,
      id: user.id,
      username: user.username,
      user_type: user.user_type, // ✅ MUST
      tokenType: "access", // 🔹 access token
      expiresIn: "7d", // 🔹 7 days instead of 20 minutes
    });

    // Optional: Store session detail in DB (same as before)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .insertInto("session_login")
      .values({
        uuid: user.uuid,
        username: email_or_username,

        session_token: sessionToken, // 🔹 refresh token stored

        ip: req.ip || null,
        deviceInfo: req.headers["user-agent"] || null,
        expire_at: expiresAt,
        created_at: new Date(),
      })
      .execute();

    // 🍪 Refresh token (long lived)
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

    // Log login activity
    await logActivity(req, {
      username: user.username,
      uuid: user.uuid,
      action: "login",
      description: `User ${
        user.username
      } logged in successfully | dual_verification=${
        user.has_dual_verification ? 1 : 0
      } | dual_type=${user.dual_verification_type || "none"}`,
    });

    // ---------------------------------------------------------
    // ✅ Successful Login Response
    // ---------------------------------------------------------
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Login successful",
      error: null,
      data: {
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        username: user.username,
        user_type: user.user_type,
        phone: user.phone,
        has_dual_verification: user.has_dual_verification,
        dual_verification_type: user.dual_verification_type,
        last_login_at: user.last_login_at,
        session_token: sessionToken,
        access_token: accessToken,
      },
      validation: null,
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error, please try again",
      data: null,
      error: "server error",
      validation: null,
    });
  }
};

// ============================================================
// 🔄 LOGOUT CONTROLLER
// ============================================================

export const logout = async (req: FastifyRequest, reply: FastifyReply) => {
  const token = req.cookies?.session_token;
  console.log("token for logout", token);

  // 1️⃣ Check if cookie is missing
  if (!token) {
    return reply.status(401).send({
      status: 0,
      statuscode: 401,
      message: "Session token is missing",
    });
  }

  // 2️⃣ Validate token in DB
  const session = await db
    .selectFrom("session_login")
    .selectAll()
    .where("session_token", "=", token)
    .executeTakeFirst();

  if (!session) {
    return reply.status(401).send({
      status: 0,
      statuscode: 401,
      message: "Invalid session or already logged out",
    });
  }

  // 3️⃣ Check if session expired
  if (new Date(session.expire_at) < new Date()) {
    // Even if expired, we still delete token & clear cookie
    await db
      .deleteFrom("session_login")
      .where("session_token", "=", token)
      .execute()
      .catch(() => {});

    reply.clearCookie("session_token", { path: "/" });
    reply.clearCookie("access_token", { path: "/" });

    return reply.status(401).send({
      status: 0,
      statuscode: 401,
      message: "Session expired",
    });
  }

  // 4️⃣ Token is valid → remove it from DB
  await db
    .deleteFrom("session_login")
    .where("session_token", "=", token)
    .execute()
    .catch(() => {});

  // 5️⃣ Clear both cookies (refresh token and access token)
  reply.clearCookie("session_token", { path: "/" });
  reply.clearCookie("access_token", { path: "/" });

  // Log logout activity
  await logActivity(req, {
    username: session.username || null,
    uuid: session.uuid || null,
    action: "logout",
    description: `User ${
      session.username || "unknown"
    } logged out successfully`,
  });

  // 6️⃣ Response
  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Logout successfully",
  });
};

// ============================================================
// 🔄 GET LOGGED USER INFORMATION CONTROLLER
// ============================================================

export const getLoggedUser = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // Get username from req.user (set by verifyJwt middleware from token)
    const username = req.user?.username;
    const uuid = req.user?.uuid;

    if (!uuid) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - uuid not found in token",
        error: "token_invalid",
        data: null,
        validation: null,
      });
    }

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

    // Fetch user details from database using username from token
    const user = await db
      .selectFrom("users")
      .select([
        "id",
        // "uuid",
        "firstname",
        "lastname",
        "username",
        "email",
        "phone",
        "sms_credits",
        "profile_image",
        "country_name",
        "country_code",
        "state",
        "city",
        "address_line",
        "registration_mode",

        "user_type",
        "team",
        "parent_username",
        "is_email_verified",
        "is_phone_verified",
        "is_active",
        "has_dual_verification",
        "dual_verification_type",
        "dual_verified_at",
        "last_login_at",
        "device_info",
        "created_at",
        "updated_at",
      ])
      .where("uuid", "=", uuid)
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "user_not_found",
        data: null,
        validation: null,
      });
    }

    // In getLoggedUser controller, replace the permissions section:

    // 🔐 Fetch user permissions from permissions table
    const permissionsRecord = await db
      .selectFrom("permissions")
      .selectAll()
      .where("username", "=", username)
      .executeTakeFirst();

    // Build feature permissions array
    const permissions: string[] = [];
    const sidebarPermissions: string[] = [];
    let canCreateReseller = false;

    if (permissionsRecord) {
      // Feature permissions
      if (permissionsRecord.create_client === 1)
        permissions.push("create_client");
      if (permissionsRecord.view_leads === 1) permissions.push("view_leads");
      if (permissionsRecord.edit_leads === 1) permissions.push("edit_leads");
      if (permissionsRecord.manage_users === 1)
        permissions.push("manage_users");
      if (permissionsRecord.view_reports === 1)
        permissions.push("view_reports");
      if (permissionsRecord.manage_automations === 1)
        permissions.push("manage_automations");
      if (permissionsRecord.billing_access === 1)
        permissions.push("billing_access");

      // Can create reseller
      canCreateReseller = permissionsRecord.can_create_reseller === 1;

      // Sidebar permissions
      if (permissionsRecord.sidebar_dashboard === 1)
        sidebarPermissions.push("sidebar_dashboard");
      if (permissionsRecord.sidebar_lead_manager === 1)
        sidebarPermissions.push("sidebar_lead_manager");
      if (permissionsRecord.sidebar_pipeline === 1)
        sidebarPermissions.push("sidebar_pipeline");
      if (permissionsRecord.sidebar_inbox === 1)
        sidebarPermissions.push("sidebar_inbox");
      if (permissionsRecord.sidebar_lead_capture === 1)
        sidebarPermissions.push("sidebar_lead_capture");
      if (permissionsRecord.sidebar_workflows === 1)
        sidebarPermissions.push("sidebar_workflows");
      if (permissionsRecord.sidebar_automations === 1)
        sidebarPermissions.push("sidebar_automations");
      if (permissionsRecord.sidebar_integrations === 1)
        sidebarPermissions.push("sidebar_integrations");
      if (permissionsRecord.sidebar_webhooks === 1)
        sidebarPermissions.push("sidebar_webhooks");
      if (permissionsRecord.sidebar_app_marketing === 1)
        sidebarPermissions.push("sidebar_app_marketing");
      if (permissionsRecord.sidebar_analytics === 1)
        sidebarPermissions.push("sidebar_analytics");
      if (permissionsRecord.sidebar_reports === 1)
        sidebarPermissions.push("sidebar_reports");
      if (permissionsRecord.sidebar_billing === 1)
        sidebarPermissions.push("sidebar_billing");
      if (permissionsRecord.sidebar_api_docs === 1)
        sidebarPermissions.push("sidebar_api_docs");
      if (permissionsRecord.sidebar_settings === 1)
        sidebarPermissions.push("sidebar_settings");
      if (permissionsRecord.sidebar_user_management === 1)
        sidebarPermissions.push("sidebar_user_management");
    }

    const USER_TYPE_NAMES: Record<number, string> = {
      1: "super_admin",
      2: "admin",
      3: "reseller",
      4: "user",
      5: "agent",
    };

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "User details fetched successfully",
      error: null,
      validation: null,
      data: {
        ...user,
        user_type_name: USER_TYPE_NAMES[Number(user.user_type)] ?? "unknown",
        permissions,
        sidebar_permissions: sidebarPermissions,
        can_create_reseller: canCreateReseller,
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
// 🔄 CHECK PASSWORD CONTROLLER
// ============================================================

export const checkPassword = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = req.body as CheckPasswordInput;
  const parse = checkPasswordSchema.safeParse(body);

  // ❌ Validation Error
  if (!parse.success) {
    return reply.status(422).send({
      status: 0,
      statuscode: 422,
      message: "Validation error",
      errors: parse.error.flatten(),
      validation: "validation error",
    });
  }

  const { currentPassword } = parse.data;
  const user = (req as any).user;

  try {
    // 🔍 Fetch user password hash
    const dbUser = await db
      .selectFrom("users")
      .select(["password_hash"])
      .where("uuid", "=", user.uuid)
      .executeTakeFirst();

    if (!dbUser) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "not found",
        validation: "invalid user",
      });
    }

    // 🔑 Check Password
    const isMatch = await bcrypt.compare(currentPassword, dbUser.password_hash);

    if (!isMatch) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Incorrect password",
        error: "unauthorized",
        validation: "password not matched",
      });
    }

    // ✅ Successful
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Password verified successfully",
      error: null,
      data: null,
      validation: null,
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error, please try again",
      error: "server error",
      validation: null,
    });
  }
};

// ============================================================
// 🔄 EDIT USER PROFILE CONTROLLER
// ============================================================

export const editUserProfile = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const user = req.user as { uuid: string; username: string };
  const parse = editProfileSchema.safeParse(req.body);

  if (!parse.success) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: "Validation error",
      data: null,
      error: parse.error.flatten(),
      validation: "validation failed",
    });
  }

  const {
    firstname,
    lastname,
    email,
    phone,
    country_name,
    country_code,
    state,
    city,
    address_line,
  } = parse.data;

  try {
    // Check conflict (email or phone)
    const conflict = await db
      .selectFrom("users")
      .select(["email", "phone"])
      .where((eb) =>
        eb.and([
          eb("uuid", "!=", user.uuid),
          eb.or([eb("email", "=", email), eb("phone", "=", phone)]),
        ]),
      )
      .execute();

    if (conflict.length > 0) {
      const errors = new Set();

      if (conflict[0].email === email) errors.add("email");
      if (conflict[0].phone === phone) errors.add("phone");

      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: `${Array.from(errors).join(", ")} already exists.`,
        data: null,
        error: "conflict error",
        validation: "already exists",
      });
    }

    await db
      .updateTable("users")
      .set({
        firstname,
        lastname,
        email,
        phone,
        country_name,
        country_code,
        state,
        city,
        address_line,
        updated_at: new Date(),
      })
      .where("uuid", "=", user.uuid)
      .execute();

    // Log edit profile activity
    await logActivity(req, {
      username: user.username,
      uuid: user.uuid,
      action: "edit_profile",
      description: `User ${user.username} updated their profile information`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Profile updated successfully",
      data: {
        firstname,
        lastname,
        email,
        phone,
        username: user.username,
        country_name,
        country_code,
        state,
        city,
        address_line,
      },
      error: null,
      validation: null,
    });
  } catch (err: any) {
    req.log.error(err);

    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Something went wrong",
      error: "internal server error",
      validation: null,
    });
  }
};

// ============================================================
// 🔄 UPLOAD AVATAR CONTROLLER
// ============================================================

export const uploadAvatar = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // 🔐 Check if user is authenticated
    const user = (req as any).user;
    console.log("user in upload avatar", user);

    if (!user) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - authentication required",
        data: null,
        error: "unauthorized",
        validation: "auth required",
      });
    }

    // Read multipart file
    const data = await req.file();
    console.log("file data", data);

    if (!data) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "No file uploaded",
        data: null,
        error: "file missing",
        validation: "validation failed",
      });
    }

    // Zod validation
    const parse = fileSchema.safeParse({
      mimetype: data.mimetype,
      filename: data.filename,
    });

    if (!parse.success) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Invalid file",
        data: null,
        error: parse.error.flatten(),
        validation: "validation failed",
      });
    }

    // ❗ FIX: use process.cwd() since __dirname does NOT exist in ESM
    const uploadDir = path.join(process.cwd(), "uploads", "avatar");
    console.log("upload directory:", uploadDir);

    // Create folder if not exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Save file
    const cleanedName = data.filename.replace(/\s+/g, "_");
    const fileName = `${Date.now()}_${cleanedName}`;
    const filePath = path.join(uploadDir, fileName);

    console.log("file path:", filePath);

    const buffer = await data.toBuffer();
    fs.writeFileSync(filePath, buffer);

    // Instead of full URL in DB, store only relative path
    const relativePath = `/uploads/avatar/${fileName}`;

    // File URL for frontend
    const fileUrl = `${
      process.env.BASE_URL || "http://localhost:3004"
    }/uploads/avatar/${fileName}`;
    console.log("file url:", fileUrl);

    // Update database
    await db
      .updateTable("users")
      .set({
        profile_image: fileUrl,
        updated_at: new Date(),
      })
      .where("uuid", "=", user.uuid)
      .execute();

    // Log upload avatar activity
    await logActivity(req, {
      username: user.username,
      uuid: user.uuid,
      action: "upload_avatar",
      description: `User ${user.username} uploaded a new profile avatar`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Avatar uploaded successfully",
      data: { profile_image: fileUrl },
      error: null,
      validation: null,
    });
  } catch (err: any) {
    req.log.error(err);
    console.log("error in upload avatar", err);

    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Something went wrong",
      error: "internal server error",
      validation: null,
    });
  }
};

// ============================================================
// 🔐 IMPERSONATE LOGIN CONTROLLER
// ============================================================
// Allows an admin to login as a user they created
// Admin can only impersonate users where parent_username matches admin's username
export const impersonateUser = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // 🔐 Get admin info from JWT token
    const adminUser = req.user as {
      uuid: string;
      username: string;
      id?: number;
    };

    console.log("adminUser in impersonate user", adminUser);

    if (!adminUser || !adminUser.username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - admin token required",
        error: "token_invalid",
        data: null,
        validation: null,
      });
    }

    // 📦 Get target user ID from request body
    const { userId } = req.body as { userId: string };
    console.log("userId", userId);

    if (!userId) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "User ID is required",
        error: "missing_user_id",
        data: null,
        validation: null,
      });
    }

    // 🔍 Fetch target user from database
    const targetUser = await db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", Number(userId))
      .executeTakeFirst();

    if (!targetUser) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Target user not found",
        error: "user_not_found",
        data: null,
        validation: null,
      });
    }

    // 🔒 CHECK IF TARGET USER ACCOUNT IS ACTIVE
    // if (targetUser.is_active !== 1) {
    //   return reply.status(403).send({
    //     status: 0,
    //     statuscode: 403,
    //     message: "Cannot impersonate disabled user account",
    //     error: "target_account_disabled",
    //     data: {
    //       target_username: targetUser.username,
    //       is_active: targetUser.is_active
    //     },
    //     validation: null,
    //   });
    // }

    // 🔍 Check if admin is actually an admin (user_type 1, 2, or 3) — do this FIRST
    const adminRecord = await db
      .selectFrom("users")
      .select(["user_type", "username", "email"])
      .where("uuid", "=", adminUser.uuid)
      .executeTakeFirst();

    if (
      !adminRecord ||
      (adminRecord.user_type !== 1 &&
        adminRecord.user_type !== 2 &&
        adminRecord.user_type !== 3)
    ) {
      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: "Only super admin, admins, reseller can impersonate users",
        error: "not_admin",
        data: null,
        validation: null,
      });
    }

    // 🔒 Parent check: super_admin (user_type 1) can impersonate any user;
    // other admins/resellers can only impersonate users they created
    // Check both username and email for matching
    console.log("Admin user_type:", adminRecord.user_type);
    console.log("Admin username:", adminUser.username);
    console.log("Admin email from DB:", adminRecord.email || "No email found");
    console.log("Target user parent_username:", targetUser.parent_username);
    console.log("Target user username:", targetUser.username);

    // Allow super admin (user_type 1) to impersonate anyone
    if (adminRecord.user_type === 1) {
      console.log("SUPER ADMIN: Allowing impersonation of any user");
    } else {
      // For regular admins, check if they can impersonate this user
      // Check multiple ways to match the parent relationship:
      // 1. Direct username match
      // 2. Email match
      // 3. Check if current admin and parent admin are the same person (by checking if parent exists and has same email)
      const canImpersonateByUsername =
        targetUser.parent_username === adminUser.username;
      const canImpersonateByEmail =
        targetUser.parent_username === adminRecord.email;

      // 🔍 NEW: Check if the parent_username refers to the same admin (by email lookup)
      let canImpersonateByParentLookup = false;
      if (
        targetUser.parent_username &&
        !canImpersonateByUsername &&
        !canImpersonateByEmail
      ) {
        const parentAdmin = await db
          .selectFrom("users")
          .select(["email", "username"])
          .where("username", "=", targetUser.parent_username)
          .executeTakeFirst();

        // If parent admin exists and has same email as current admin, allow impersonation
        if (parentAdmin && parentAdmin.email === adminRecord.email) {
          canImpersonateByParentLookup = true;
          console.log(
            "PARENT LOOKUP: Found matching admin by email",
            parentAdmin.email,
          );
        }
      }

      console.log("Can impersonate by username:", canImpersonateByUsername);
      console.log("Can impersonate by email:", canImpersonateByEmail);
      console.log(
        "Can impersonate by parent lookup:",
        canImpersonateByParentLookup,
      );

      if (
        !canImpersonateByUsername &&
        !canImpersonateByEmail &&
        !canImpersonateByParentLookup
      ) {
        console.log("IMPERSONATION DENIED: No valid parent relationship found");
        console.log(
          `Expected parent_username: '${adminUser.username}' OR '${adminRecord.email}', Got: '${targetUser.parent_username}'`,
        );
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: `You can only impersonate users you created. This user was created by: ${targetUser.parent_username || "Unknown"}`,
          error: "unauthorized_impersonation",
          data: {
            admin_username: adminUser.username,
            admin_email: adminRecord.email,
            target_parent_username: targetUser.parent_username,
            admin_user_type: adminRecord.user_type,
          },
          validation: null,
        });
      } else {
        const matchMethod = canImpersonateByUsername
          ? "username"
          : canImpersonateByEmail
            ? "email"
            : "parent_lookup";
        console.log("IMPERSONATION ALLOWED: Match found via", matchMethod);
      }
    }

    // 🌍 IP + Device Info
    const ip =
      req.ip || req.headers["x-forwarded-for"]?.toString() || "0.0.0.0";
    const deviceInfo = req.headers["user-agent"] || null;

    // if (!canImpersonate(adminRecord.user_type, targetUser.user_type)) {
    //   return reply.status(403).send({
    //     status: 0,
    //     statuscode: 403,
    //     message: "You cannot impersonate this user",
    //     error: "rbac_impersonation_denied",
    //   });
    // }

    // 🔐 Generate JWT Token for target user (impersonated session)
    // const { token } = generateJwtToken({
    //   uuid: targetUser.uuid,
    //   id: targetUser.id,
    //   username: targetUser.username,
    //   expiresIn: "7d",
    // });
    const { token: sessionToken } = generateJwtToken({
      uuid: targetUser.uuid,
      id: targetUser.id,
      username: targetUser.username,
      tokenType: "session",
      expiresIn: "7d",
    });

    const { token: accessToken } = generateJwtToken({
      uuid: targetUser.uuid,
      id: targetUser.id,
      username: targetUser.username,
      user_type: targetUser.user_type, // ✅ MUST
      tokenType: "access",
      expiresIn: "7d", // 7 Days
    });

    // ⏰ Session expiration (7 days)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 💾 Store impersonated session in database
    // Note: If your session_login table doesn't have original_admin_uuid column,
    // you'll need to add it: ALTER TABLE session_login ADD COLUMN original_admin_uuid VARCHAR(100) NULL;
    await db
      .insertInto("session_login")
      .values({
        uuid: targetUser.uuid, // Target user's UUID
        username: targetUser.username, // Target user's username
        // session_token: token,
        session_token: sessionToken, // JWT token for target user
        ip: ip,
        deviceInfo: deviceInfo,
        expire_at: expiresAt,
        created_at: new Date(),
        // Store original admin info for tracking (if column exists)
        // original_admin_uuid: adminUser.uuid,
        // original_admin_username: adminUser.username,
      })
      .execute();

    // 🍪 Store JWT in Cookie (this will replace admin's session)
    // reply.setCookie("session_token", token, {
    //   httpOnly: true,
    //   secure: process.env.NODE_ENV === "production",
    //   sameSite: "lax",
    //   maxAge: 7 * 24 * 60 * 60, // 7 days
    //   path: "/",
    // });
    // 🍪 Refresh token (long lived)
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

    // 📝 Log impersonation activity
    await logActivity(req, {
      username: adminUser.username,
      uuid: adminUser.uuid,
      action: "impersonate_login",
      description: `Admin ${adminUser.username} impersonated user ${targetUser.username} (ID: ${targetUser.id})`,
    });

    // ✅ Success Response
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Impersonation successful",
      error: null,
      data: {
        token: sessionToken,
        session_token: sessionToken,
        access_token: accessToken,
        impersonated_user: {
          id: targetUser.id,
          uuid: targetUser.uuid,
          firstname: targetUser.firstname,
          lastname: targetUser.lastname,
          email: targetUser.email,
          username: targetUser.username,
          phone: targetUser.phone,
        },
        original_admin: {
          username: adminUser.username,
          uuid: adminUser.uuid,
        },
        is_impersonating: true,
      },
      validation: null,
    });
  } catch (err: any) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error during impersonation",
      error: "server_error",
      data: null,
      validation: null,
    });
  }
};

// ============================================================
// 🔐 END IMPERSONATION CONTROLLER
// ============================================================
// Allows admin to logout from impersonated session and return to their own session
// This endpoint should be called when admin wants to stop impersonating
export const endImpersonation = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // 🔐 Get current session token
    const token =
      req.cookies?.session_token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Session token is missing",
        error: "token_missing",
        data: null,
        validation: null,
      });
    }

    // 🔍 Find current session
    const currentSession = await db
      .selectFrom("session_login")
      .selectAll()
      .where("session_token", "=", token)
      .executeTakeFirst();

    if (!currentSession) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Invalid session",
        error: "session_not_found",
        data: null,
        validation: null,
      });
    }

    // 🔍 Get current user (impersonated user)
    const currentUser = await db
      .selectFrom("users")
      .select(["uuid", "username", "parent_username"])
      .where("uuid", "=", currentSession.uuid)
      .executeTakeFirst();

    if (!currentUser) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "user_not_found",
        data: null,
        validation: null,
      });
    }

    // 🔍 Find admin who created this user (original admin)
    // Use flexible lookup similar to impersonation logic
    console.log(
      "Looking for admin with parent_username:",
      currentUser.parent_username,
    );
    let adminUser = await db
      .selectFrom("users")
      .selectAll()
      .where("username", "=", currentUser.parent_username)
      .executeTakeFirst();

    // If direct username lookup fails, try to find admin by email match
    if (!adminUser && currentUser.parent_username) {
      console.log("Direct username lookup failed, trying email match");
      // Look for any admin user whose email matches the parent_username
      adminUser = await db
        .selectFrom("users")
        .selectAll()
        .where("email", "=", currentUser.parent_username)
        .where((eb) =>
          eb.or([
            eb("user_type", "=", 1), // super admin
            eb("user_type", "=", 2), // admin
            eb("user_type", "=", 3), // reseller
          ]),
        )
        .executeTakeFirst();
    }

    // If still not found, try reverse lookup - find admin with same email as parent_username user
    if (!adminUser && currentUser.parent_username) {
      console.log("Email match failed, trying reverse lookup");
      const parentUser = await db
        .selectFrom("users")
        .select(["email"])
        .where("username", "=", currentUser.parent_username)
        .executeTakeFirst();

      if (parentUser?.email) {
        console.log(
          "Found parent user email:",
          parentUser.email,
          "looking for admin with same email",
        );
        adminUser = await db
          .selectFrom("users")
          .selectAll()
          .where("email", "=", parentUser.email)
          .where((eb) =>
            eb.or([
              eb("user_type", "=", 1), // super admin
              eb("user_type", "=", 2), // admin
              eb("user_type", "=", 3), // reseller
            ]),
          )
          .executeTakeFirst();
      }
    }

    if (adminUser) {
      console.log(
        "Found admin user:",
        adminUser.username,
        "email:",
        adminUser.email,
      );
    }

    if (!adminUser) {
      console.log(
        "ADMIN LOOKUP FAILED: Could not find admin for parent_username:",
        currentUser.parent_username,
      );
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Original admin not found. Unable to restore admin session.",
        error: "admin_not_found",
        data: {
          parent_username: currentUser.parent_username,
          current_user: currentUser.username,
        },
        validation: null,
      });
    }

    // 🗑️ Delete impersonated session
    await db
      .deleteFrom("session_login")
      .where("session_token", "=", token)
      .execute()
      .catch(() => {});

    // 🔍 Fetch admin user_type for token generation
    const adminRecord = await db
      .selectFrom("users")
      .select(["user_type"])
      .where("uuid", "=", adminUser.uuid)
      .executeTakeFirst();

    if (!adminRecord) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Admin user not found",
        error: "admin_not_found",
        data: null,
        validation: null,
      });
    }

    // ---------------------------------------------------------
    // 🔐 Generate SESSION TOKEN (REFRESH TOKEN - 7 days)
    // ---------------------------------------------------------
    const { token: adminSessionToken } = generateJwtToken({
      uuid: adminUser.uuid,
      id: adminUser.id,
      username: adminUser.username,
      tokenType: "session", // 🔹 refresh token
      expiresIn: "7d",
    });

    // ---------------------------------------------------------
    // 🔐 Generate ACCESS TOKEN (SHORT LIVED - 20 min)
    // ---------------------------------------------------------
    const { token: adminAccessToken } = generateJwtToken({
      uuid: adminUser.uuid,
      id: adminUser.id,
      username: adminUser.username,
      user_type: adminRecord.user_type, // ✅ Include user_type for role-based access
      tokenType: "access", // 🔹 access token
      expiresIn: "7d", // 🔹 7 days instead of 20 minutes
    });

    // ⏰ Session expiration
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 🌍 IP + Device Info
    const ip =
      req.ip || req.headers["x-forwarded-for"]?.toString() || "0.0.0.0";
    const deviceInfo = req.headers["user-agent"] || null;

    // 💾 Create new session for original admin (refresh token stored)
    await db
      .insertInto("session_login")
      .values({
        uuid: adminUser.uuid,
        username: adminUser.username,
        session_token: adminSessionToken, // 🔹 refresh token stored
        ip: ip,
        deviceInfo: deviceInfo,
        expire_at: expiresAt,
        created_at: new Date(),
      })
      .execute();

    // 🍪 Refresh token (long lived - 7 days)
    reply.setCookie("session_token", adminSessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    // 🍪 Access token (long lived - 7 days)
    reply.setCookie("access_token", adminAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 🔹 7 days
      path: "/",
    });

    // 📝 Log end impersonation activity
    await logActivity(req, {
      username: adminUser.username,
      uuid: adminUser.uuid,
      action: "end_impersonation",
      description: `Admin ${adminUser.username} ended impersonation of user ${currentUser.username}`,
    });

    // ✅ Success Response
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Impersonation ended successfully",
      error: null,
      data: {
        session_token: adminSessionToken,
        access_token: adminAccessToken,
        admin_user: {
          id: adminUser.id,
          uuid: adminUser.uuid,
          firstname: adminUser.firstname,
          lastname: adminUser.lastname,
          email: adminUser.email,
          username: adminUser.username,
        },
        is_impersonating: false,
      },
      validation: null,
    });
  } catch (err: any) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error ending impersonation",
      error: "server_error",
      data: null,
      validation: null,
    });
  }
};

// ============================================================
// 🔄 REFRESH TOKEN CONTROLLER
// ============================================================
// Uses session_token (refresh token) to issue new access_token
export const refreshAccessToken = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // 1️⃣ Get refresh token from cookie
    const sessionToken = req.cookies?.session_token;

    if (!sessionToken) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Refresh token missing",
        error: "refresh_token_missing",
      });
    }

    // 2️⃣ Verify refresh token SIGNATURE (ignore expiry)
    let decoded: {
      uuid?: string;
      id?: number;
      username?: string;
      token_type?: string;
    };

    try {
      decoded = jwt.verify(sessionToken, process.env.JWT_SECRET!, {
        ignoreExpiration: true,
      }) as any;
    } catch {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Invalid refresh token",
        error: "token_invalid",
      });
    }

    // 3️⃣ Ensure token is SESSION token
    if (decoded.token_type !== "session") {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Invalid refresh token type",
        error: "invalid_token_type",
      });
    }

    const now = new Date();

    // 4️⃣ Validate session from DB
    const session = await db
      .selectFrom("session_login")
      .selectAll()
      .where("session_token", "=", sessionToken)
      .executeTakeFirst();

    if (!session || session.is_revoked === 1) {
      // Clear authentication cookies when session is invalid or revoked
      reply.clearCookie("session_token", { path: "/" });
      reply.clearCookie("access_token", { path: "/" });
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Session invalid or revoked",
        error: "session_invalid",
      });
    }

    if (new Date(session.expire_at) < now) {
      // Clear cookies if refresh session has expired
      reply.clearCookie("session_token", { path: "/" });
      reply.clearCookie("access_token", { path: "/" });
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Refresh token expired",
        error: "session_expired",
      });
    }

    /* =====================================================
       🔥 NEW STEP: FETCH LATEST ROLE FROM DB AND CHECK ACTIVE STATUS
    ====================================================== */
    const user = await db
      .selectFrom("users")
      .select(["user_type", "is_active"])
      .where("uuid", "=", session.uuid)
      .executeTakeFirst();

    if (!user?.user_type) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "User role not found",
        error: "role_missing",
      });
    }

    // 🔒 CHECK IF USER ACCOUNT IS STILL ACTIVE
    if (user.is_active !== 1) {
      // Clear authentication cookies when account is disabled
      reply.clearCookie("session_token", { path: "/" });
      reply.clearCookie("access_token", { path: "/" });

      // Revoke the session
      await db
        .updateTable("session_login")
        .set({ is_revoked: 1 })
        .where("id", "=", session.id)
        .execute();

      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: "Account has been disabled. Please contact administrator.",
        error: "account_disabled",
      });
    }

    // 5️⃣ Generate NEW ACCESS TOKEN (with latest role)
    const { token: newAccessToken } = generateJwtToken({
      uuid: session.uuid,
      id: decoded.id,
      username: session.username,
      user_type: user.user_type, // ✅ LATEST ROLE
      tokenType: "access",
      expiresIn: "7d", // 🔹 7 days instead of 20 minutes
    });

    // 6️⃣ Update activity
    await db
      .updateTable("session_login")
      .set({ last_active_at: now })
      .where("id", "=", session.id)
      .execute();

    // 7️⃣ Set new access token cookie (long lived - 7 days)
    reply.setCookie("access_token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 🔹 7 days
      path: "/",
    });

    // 8️⃣ Success
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Access token refreshed successfully",
      data: { refreshed: true, access_token: newAccessToken },
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error while refreshing token",
      error: "server_error",
    });
  }
};
