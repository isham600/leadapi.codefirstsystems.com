import { FastifyRequest, FastifyReply } from "fastify";

import { db } from "../../../models/db.js";
import { ensureWallet } from "../../billing/services/wallet.service.js";
import { validateRatesAgainstParent } from "../../billing/services/pricing.service.js";
import {
  addUserSchema,
  addUserInput,
  updateUserSchema,
} from "../schema/auth.schema.js";
import { generateJwtToken } from "../../../plugins/jwt.js";
import { generateCustomUUID } from "./auth.controller.js";
import { logActivity } from "../utils/logActivity.js";
import bcrypt from "bcryptjs";
import { sql } from "kysely";
import {
  canAccessUserManagement,
  FEATURE_PERMISSION_KEYS,
  getAllowedUserTypes,
  getAllPermissions,
  getDefaultPermissions,
  getGrantableFeaturePermissions,
  getGrantableSidebarPermissions,
  SIDEBAR_PERMISSION_KEYS,
  CHANNEL_PERMISSION_KEYS,
  INTEGRATION_PERMISSION_KEYS,
  ALL_GRANTABLE_SIDEBAR_KEYS,
  userTypesToRoles,
  validateFeaturePermissionGrant,
  validateSidebarPermissionGrant,
} from "../utils/permissionHelpers.js";

const ROLE_MAP: Record<string, number> = {
  admin: 2,
  reseller: 3,
  user: 4,
  agent: 5,
};

const STATUS_MAP: Record<string, number> = {
  is_active: 1 || 0,
};

// ============================================================
// 🔐 addUserClientManagement CONTROLLER
// ============================================================
export const addUserClientManagement = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const parentUsername = req.user?.username;

    if (!parentUsername) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - token invalid",
        error: "token_invalid",
        data: null,
      });
    }

    // Get current user info
    const currentUser = await db
      .selectFrom("users")
      .select(["user_type", "username"])
      .where("username", "=", parentUsername)
      .executeTakeFirst();

    if (!currentUser) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Current user not found",
        error: "user_not_found",
        data: null,
      });
    }

    // Check if current user can access user management
    if (!canAccessUserManagement(currentUser.user_type)) {
      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: "You do not have access to user management",
        error: "access_denied",
        data: null,
      });
    }

    // Validate request body
    const body = req.body as any;
    const parse = addUserSchema.safeParse(body);

    if (!parse.success) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Validation error",
        error: parse.error.flatten(),
        data: null,
      });
    }

    const {
      firstname,
      lastname,
      email,
      username,
      password,
      phone,
      team,
      role,
      permissions = [],
      sidebar_permissions = [],
      can_create_reseller = false,
    } = parse.data;

    // Optional pricing profiles array from request body (not in schema — read directly)
    const pricingProfiles: any[] = Array.isArray((req.body as any).pricing_profiles)
      ? (req.body as any).pricing_profiles
      : [];

    // Resolve role to user_type
    const userType = ROLE_MAP[role ?? "user"] ?? 4;

    // Get parent's permissions
    const parentPermissions = await getAllPermissions(currentUser.username);
    if (!parentPermissions) {
      return reply.status(500).send({
        status: 0,
        statuscode: 500,
        message: "Failed to fetch parent permissions",
        error: "permission_error",
        data: null,
      });
    }

    // Get allowed user types based on parent's permissions
    const canCreateResellerBool = parentPermissions.can_create_reseller === 1;
    const allowedUserTypes = getAllowedUserTypes(
      currentUser.user_type,
      canCreateResellerBool,
    );

    // Validate user type
    if (!allowedUserTypes.includes(userType)) {
      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: `You don't have permission to create ${role} users`,
        error: "permission_denied",
        data: null,
      });
    }

    // Validate can_create_reseller grant
    if (can_create_reseller) {
      if (
        currentUser.user_type !== 1 &&
        parentPermissions.can_create_reseller !== 1
      ) {
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: "You don't have 'can create reseller' permission to grant",
          error: "permission_denied",
          data: null,
        });
      }
    }

    // Validate feature permissions grant
    if (permissions && permissions.length > 0) {
      const validation = validateFeaturePermissionGrant(
        parentPermissions,
        permissions,
        currentUser.user_type,
      );

      if (!validation.valid) {
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: validation.error,
          error: "permission_denied",
          unauthorized_permissions: validation.unauthorized,
          data: null,
        });
      }
    }

    // Validate sidebar permissions grant
    if (sidebar_permissions && sidebar_permissions.length > 0) {
      const sidebarValidation = validateSidebarPermissionGrant(
        parentPermissions,
        sidebar_permissions,
        currentUser.user_type,
        userType,
      );

      if (!sidebarValidation.valid) {
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: sidebarValidation.error,
          error: "sidebar_permission_denied",
          unauthorized_permissions: sidebarValidation.unauthorized,
          data: null,
        });
      }
    }

    // Conflict check
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
        message: `${Array.from(errors).join(", ")} already exists`,
        error: "conflict_error",
        data: null,
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    const userUUID = generateCustomUUID();
    const { token: permanentToken } = generateJwtToken({
      username,
      expiresIn: undefined,
    });

    // Insert user
    await db
      .insertInto("users")
      .values({
        uuid: userUUID,
        firstname,
        lastname,
        username,
        email,
        password_hash: passwordHash,
        phone,
        team,
        user_type: userType,
        parent_username: currentUser.username,
        permanent_token: permanentToken,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    // Build permissions object
    const permissionValues: any = {
      uuid: userUUID,
      username,
      // Feature permissions - default all to 0
      create_client: 0,
      view_leads: 0,
      edit_leads: 0,
      manage_users: 0,
      view_reports: 0,
      manage_automations: 0,
      billing_access: 0,
      can_create_reseller: can_create_reseller ? 1 : 0,
      // Sidebar permissions - dashboard always on, user_management based on role
      sidebar_dashboard: 1,
      sidebar_lead_manager: 0,
      sidebar_pipeline: 0,
      sidebar_inbox: 0,
      sidebar_lead_capture: 0,
      sidebar_workflows: 0,
      sidebar_automations: 0,
      sidebar_integrations: 0,
      sidebar_webhooks: 0,
      sidebar_app_marketing: 0,
      sidebar_analytics: 0,
      sidebar_reports: 0,
      sidebar_billing: 0,
      sidebar_api_docs: 0,
      sidebar_settings: 0,
      sidebar_user_management: 0,
      // Channel permissions
      channel_whatsapp: 0,
      channel_sms: 0,
      channel_rcs: 0,
      channel_email: 0,
      channel_voice: 0,
      channel_ai_calling: 0,
      channel_meta_ads: 0,
      channel_google_ads: 0,
      // Integration permissions
      integration_whatsapp: 0,
      integration_sms: 0,
      integration_rcs: 0,
      integration_email: 0,
      integration_voice: 0,
      integration_meta_ads: 0,
      integration_google_ads: 0,
      // Other
      team: team || null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Set feature permissions from array
    if (permissions && Array.isArray(permissions)) {
      permissions.forEach((perm: string) => {
        if (FEATURE_PERMISSION_KEYS.includes(perm as any)) {
          permissionValues[perm] = 1;
        }
      });
    }

    // Set sidebar / channel / integration permissions from array
    if (sidebar_permissions && Array.isArray(sidebar_permissions)) {
      sidebar_permissions.forEach((perm: string) => {
        // Agents can't have user_management
        if (perm === "sidebar_user_management" && userType === 5) {
          return;
        }
        if (ALL_GRANTABLE_SIDEBAR_KEYS.includes(perm as any)) {
          permissionValues[perm] = 1;
        }
      });
    }

    await db.insertInto("permissions").values(permissionValues).execute();

    // ── Pricing profiles (optional) ──────────────────────────────────────────
    if (pricingProfiles.length > 0) {
      // Create wallet first
      await ensureWallet(username);

      const pricingErrors: string[] = [];

      for (const p of pricingProfiles) {
        try {
          const input = {
            username,
            channel:           p.channel,
            category:          p.category,
            ratePerUnit:       parseFloat(p.rate_per_unit ?? 0),
            connectionCharge:  parseFloat(p.connection_charge ?? 0),
            pulseSeconds:      parseInt(p.pulse_seconds ?? 0, 10),
            durationRate:      parseFloat(p.duration_rate ?? 0),
            aiProcessingCost:  parseFloat(p.ai_processing_cost ?? 0),
            cpc:               parseFloat(p.cpc ?? 0),
            cpl:               parseFloat(p.cpl ?? 0),
            billingMode:       p.billing_mode ?? "submission",
            billOnSent:        p.bill_on_sent ? 1 : 0,
            billOnDelivered:   p.bill_on_delivered !== undefined ? (p.bill_on_delivered ? 1 : 0) : 1,
            billOnRead:        p.bill_on_read ? 1 : 0,
            billOnFailed:      p.bill_on_failed ? 1 : 0,
            billOnBlocked:     p.bill_on_blocked ? 1 : 0,
            refundOnFailed:    p.refund_on_failed ? 1 : 0,
            refundOnBlocked:   p.refund_on_blocked ? 1 : 0,
            createdBy:         parentUsername,
          };

          // Validate inheritance constraint
          await validateRatesAgainstParent(input);

          const result: any = await (db as any)
            .insertInto("pricing_profiles")
            .values({
              username,
              channel:            input.channel,
              category:           input.category,
              rate_per_unit:      input.ratePerUnit,
              connection_charge:  input.connectionCharge,
              pulse_seconds:      input.pulseSeconds,
              duration_rate:      input.durationRate,
              ai_processing_cost: input.aiProcessingCost,
              cpc:                input.cpc,
              cpl:                input.cpl,
              billing_mode:       input.billingMode,
              bill_on_sent:       input.billOnSent,
              bill_on_delivered:  input.billOnDelivered,
              bill_on_read:       input.billOnRead,
              bill_on_failed:     input.billOnFailed,
              bill_on_blocked:    input.billOnBlocked,
              refund_on_failed:   input.refundOnFailed,
              refund_on_blocked:  input.refundOnBlocked,
              is_active:          1,
              created_by:         parentUsername,
            })
            .execute();

          // Voice slabs
          const profileId = Number(result.insertId);
          if (Array.isArray(p.voice_slabs) && p.voice_slabs.length > 0) {
            for (let i = 0; i < p.voice_slabs.length; i++) {
              const s = p.voice_slabs[i];
              await (db as any)
                .insertInto("voice_slab_pricing")
                .values({
                  pricing_profile_id: profileId,
                  slab_order:         i + 1,
                  duration_from_sec:  parseInt(s.duration_from_sec ?? 0, 10),
                  duration_to_sec:    s.duration_to_sec ? parseInt(s.duration_to_sec, 10) : null,
                  rate_per_pulse:     parseFloat(s.rate_per_pulse ?? 0),
                })
                .execute();
            }
          }
        } catch (err: any) {
          pricingErrors.push(`${p.channel}/${p.category}: ${err?.message ?? "unknown error"}`);
        }
      }

      if (pricingErrors.length > 0) {
        // User was created — just attach warning, don't fail the request
        console.warn(`[addUser] Pricing errors for ${username}:`, pricingErrors);
      }
    }

    // Log activity
    await logActivity(req, {
      username,
      uuid: userUUID,
      action: "Add User",
      description: `User ${username} (${role}) added by ${currentUser.username}`,
    });

    return reply.status(201).send({
      status: 1,
      statusCode: 201,
      message: "User added successfully",
      error: null,
      data: {
        firstname,
        lastname,
        username,
        email,
        phone,
        role: role ?? "user",
        userType,
        team,
        parentName: currentUser.username,
      },
    });
  } catch (err) {
    req.log.error(err);
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
// 🔐 getUserAccounts CONTROLLER
// ============================================================
export const getUserAccounts = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // 🔐 username from JWT
    const username = req.user?.username;

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

    // 🔍 Check current user's type to determine filtering logic
    let currentUser = await db
      .selectFrom("users")
      .select(["user_type", "username", "id", "email"])
      .where("username", "=", username)
      .executeTakeFirst();

    // If direct username lookup fails, try to find user by email
    if (!currentUser) {
      currentUser = await db
        .selectFrom("users")
        .select(["user_type", "username", "id", "email"])
        .where("email", "=", username)
        .executeTakeFirst();
    }

    if (!currentUser) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Current user not found",
        error: "user_not_found",
        data: null,
        validation: null,
      });
    }

    // � Query params
    const {
      page = 1,
      limit = 10,
      search,
      is_active,
      user_type,
    } = req.query as {
      page?: number | string;
      limit?: number | string;
      search?: string;
      is_active?: number | string;
      user_type?: number | string;
    };

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const offset = (pageNum - 1) * limitNum;

    // 🔍 Base query - Filter based on user type
    let query = db
      .selectFrom("users")
      .select([
        "id",
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
        "user_type",
        "parent_username",
        "is_active",
        "is_email_verified",
        "is_phone_verified",
        "has_dual_verification",
        "dual_verification_type",
        "last_login_at",
        "created_at",
        "updated_at",
      ])
      .where("username", "!=", currentUser.username);

    // 🔒 Apply filtering based on user type
    if (currentUser.user_type === 1) {
      // Super admin can see all users (no additional filtering)
    } else {
      // Regular admins/resellers can only see users they created
      query = query
        .where((eb) =>
          eb.or([
            eb("parent_username", "=", username),
            eb("parent_username", "=", currentUser.username),
            eb("parent_username", "=", currentUser.email || ""),
          ]),
        )
        .where("parent_username", "is not", null);
    }

    // 🎯 Filter: is_active
    if (is_active !== undefined) {
      query = query.where("is_active", "=", Number(is_active));
    }

    // 🎯 Filter: user_type
    if (user_type !== undefined) {
      query = query.where("user_type", "=", Number(user_type));
    }

    // 🔍 Search (name, username, email, phone)
    if (search && search.trim() !== "") {
      query = query.where((eb) =>
        eb.or([
          eb("firstname", "like", `%${search}%`),
          eb("lastname", "like", `%${search}%`),
          eb("username", "like", `%${search}%`),
          eb("email", "like", `%${search}%`),
          eb("phone", "like", `%${search}%`),
        ]),
      );
    }

    // 🔢 Total count (for pagination)
    const countResult = await query
      .clearSelect()
      .select(db.fn.count("id").as("total"))
      .executeTakeFirst();

    const total = Number(countResult?.total || 0);

    // 📦 Paginated data - Order by created_at DESC (newest first)
    const accounts = await query
      .orderBy("created_at", "desc")
      .limit(limitNum)
      .offset(offset)
      .execute();

    // 🔐 Fetch permissions for all accounts (only if accounts exist)
    const permissionsMap = new Map();

    // After fetching accounts, fetch all permissions
    if (accounts.length > 0) {
      const usernames = accounts.map((acc) => acc.username);
      const permissionsData = await db
        .selectFrom("permissions")
        .selectAll()
        .where("username", "in", usernames)
        .execute();

      // Create a map of username to all permissions
      permissionsData.forEach((perm) => {
        const featurePerms: string[] = [];
        const sidebarPerms: string[] = [];

        // Feature permissions
        if (perm.create_client) featurePerms.push("create_client");
        if (perm.view_leads) featurePerms.push("view_leads");
        if (perm.edit_leads) featurePerms.push("edit_leads");
        if (perm.manage_users) featurePerms.push("manage_users");
        if (perm.view_reports) featurePerms.push("view_reports");
        if (perm.manage_automations) featurePerms.push("manage_automations");
        if (perm.billing_access) featurePerms.push("billing_access");

        // Sidebar permissions
        if (perm.sidebar_dashboard) sidebarPerms.push("sidebar_dashboard");
        if (perm.sidebar_lead_manager) sidebarPerms.push("sidebar_lead_manager");
        if (perm.sidebar_pipeline) sidebarPerms.push("sidebar_pipeline");
        if (perm.sidebar_inbox) sidebarPerms.push("sidebar_inbox");
        if (perm.sidebar_lead_capture) sidebarPerms.push("sidebar_lead_capture");
        if (perm.sidebar_workflows) sidebarPerms.push("sidebar_workflows");
        if (perm.sidebar_automations) sidebarPerms.push("sidebar_automations");
        if (perm.sidebar_integrations) sidebarPerms.push("sidebar_integrations");
        if (perm.sidebar_webhooks) sidebarPerms.push("sidebar_webhooks");
        if (perm.sidebar_app_marketing) sidebarPerms.push("sidebar_app_marketing");
        if (perm.sidebar_analytics) sidebarPerms.push("sidebar_analytics");
        if (perm.sidebar_reports) sidebarPerms.push("sidebar_reports");
        if (perm.sidebar_billing) sidebarPerms.push("sidebar_billing");
        if (perm.sidebar_api_docs) sidebarPerms.push("sidebar_api_docs");
        if (perm.sidebar_settings) sidebarPerms.push("sidebar_settings");
        if (perm.sidebar_user_management) sidebarPerms.push("sidebar_user_management");
        // Channel permissions
        if (perm.channel_whatsapp) sidebarPerms.push("channel_whatsapp");
        if (perm.channel_sms) sidebarPerms.push("channel_sms");
        if (perm.channel_rcs) sidebarPerms.push("channel_rcs");
        if (perm.channel_email) sidebarPerms.push("channel_email");
        if (perm.channel_voice) sidebarPerms.push("channel_voice");
        if (perm.channel_ai_calling) sidebarPerms.push("channel_ai_calling");
        if (perm.channel_meta_ads) sidebarPerms.push("channel_meta_ads");
        if (perm.channel_google_ads) sidebarPerms.push("channel_google_ads");
        // Integration permissions
        if (perm.integration_whatsapp) sidebarPerms.push("integration_whatsapp");
        if (perm.integration_sms) sidebarPerms.push("integration_sms");
        if (perm.integration_rcs) sidebarPerms.push("integration_rcs");
        if (perm.integration_email) sidebarPerms.push("integration_email");
        if (perm.integration_voice) sidebarPerms.push("integration_voice");
        if (perm.integration_meta_ads) sidebarPerms.push("integration_meta_ads");
        if (perm.integration_google_ads) sidebarPerms.push("integration_google_ads");

        permissionsMap.set(perm.username, {
          permissions: featurePerms,
          sidebar_permissions: sidebarPerms,
          can_create_reseller: perm.can_create_reseller === 1,
          team: perm.team || null,
        });
      });
    }

    // Add to accounts
    const accountsWithPermissions = accounts.map((acc) => {
      const permData = permissionsMap.get(acc.username) || {
        permissions: [],
        sidebar_permissions: [],
        can_create_reseller: false,
        team: null,
      };
      return {
        ...acc,
        permissions: permData.permissions,
        sidebar_permissions: permData.sidebar_permissions,
        can_create_reseller: permData.can_create_reseller, // ✅ FIX: Include this
        team: permData.team,
      };
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Accounts fetched successfully",
      error: null,
      validation: null,
      data: {
        parent_username: currentUser.username,
        current_user_type: currentUser.user_type,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: total,
          total_pages: Math.ceil(total / limitNum),
        },
        filters: {
          search: search || null,
          is_active: is_active ?? null,
          user_type: user_type ?? null,
        },
        accounts: accountsWithPermissions,
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
// 🔐  updateUserClientManagement CONTROLLER
// ============================================================
export const updateUserClientManagement = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const parentUsername = req.user?.username;
    if (!parentUsername) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "token_invalid",
        data: null,
      });
    }

    username: parentUsername?.trim();
    // firstname: firstname?.trim();
    // lastname: lastname?.trim();

    // Get current user info
    const currentUser = await db
      .selectFrom("users")
      .select(["user_type", "username"])
      .where("username", "=", parentUsername)
      .executeTakeFirst();

    if (!currentUser) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Current user not found",
        error: "user_not_found",
        data: null,
      });
    }

    const { id } = req.params as { id: number };

    if (!id) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "User id is required",
        error: "invalid_params",
        data: null,
      });
    }

    const parse = updateUserSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Validation error",
        error: parse.error.flatten(),
        data: null,
      });
    }

    const {
      firstname,
      lastname,
      email,
      phone,
      password,
      role,
      team,
      permissions = [],
      sidebar_permissions = [],
      can_create_reseller = false,
    } = parse.data;

    // Check user exists
    // 🔐 Ownership: super-admin may edit anyone; others only users they created
    let existingUserQuery = db
      .selectFrom("users")
      .select(["id", "username", "user_type"])
      .where("id", "=", id);
    if (currentUser.user_type !== 1) {
      existingUserQuery = existingUserQuery.where((eb) =>
        eb.or([
          eb("parent_username", "=", parentUsername),
          eb("parent_username", "=", currentUser.username),
        ]),
      );
    }
    const existingUser = await existingUserQuery.executeTakeFirst();

    if (!existingUser) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "not_found",
        data: null,
      });
    }

    // Resolve role
    let userType = existingUser.user_type;
    if (role) {
      userType = ROLE_MAP[role] ?? 4;
    }

    // Get parent's permissions
    const parentPermissions = await getAllPermissions(currentUser.username);
    if (!parentPermissions) {
      return reply.status(500).send({
        status: 0,
        statuscode: 500,
        message: "Failed to fetch parent permissions",
        error: "permission_error",
        data: null,
      });
    }

    // Validate role change
    if (role) {
      const canCreateResellerBool = parentPermissions.can_create_reseller === 1;
      const allowedUserTypes = getAllowedUserTypes(
        currentUser.user_type,
        canCreateResellerBool,
      );

      if (!allowedUserTypes.includes(userType)) {
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: `You don't have permission to assign ${role} role`,
          error: "permission_denied",
          data: null,
        });
      }
    }

    // Validate can_create_reseller grant
    if (can_create_reseller) {
      if (
        currentUser.user_type !== 1 &&
        parentPermissions.can_create_reseller !== 1
      ) {
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: "You don't have 'can create reseller' permission to grant",
          error: "permission_denied",
          data: null,
        });
      }
    }

    // Validate feature permissions
    if (permissions && permissions.length > 0) {
      const validation = validateFeaturePermissionGrant(
        parentPermissions,
        permissions,
        currentUser.user_type,
      );

      if (!validation.valid) {
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: validation.error,
          error: "permission_denied",
          data: null,
        });
      }
    }

    // Validate sidebar permissions
    if (sidebar_permissions && sidebar_permissions.length > 0) {
      const sidebarValidation = validateSidebarPermissionGrant(
        parentPermissions,
        sidebar_permissions,
        currentUser.user_type,
        userType,
      );

      if (!sidebarValidation.valid) {
        return reply.status(403).send({
          status: 0,
          statuscode: 403,
          message: sidebarValidation.error,
          error: "sidebar_permission_denied",
          data: null,
        });
      }
    }

    // Conflict check
    const conflicts = await db
      .selectFrom("users")
      .select(["email", "phone"])
      .where((eb) => eb.or([eb("email", "=", email), eb("phone", "=", phone)]))
      .where("id", "!=", id)
      .execute();

    if (conflicts.length > 0) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Email or phone already exists",
        error: "conflict_error",
        data: null,
      });
    }

    // Password update
    let passwordHash: string | undefined;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    // Update user
    await db
      .updateTable("users")
      .set({
        firstname,
        lastname,
        email,
        phone,
        team,
        user_type: userType,
        ...(passwordHash && { password_hash: passwordHash }),
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();

    // Build permission update object
    const permissionUpdate: any = {
      // Feature permissions - reset all to 0 first
      create_client: 0,
      view_leads: 0,
      edit_leads: 0,
      manage_users: 0,
      view_reports: 0,
      manage_automations: 0,
      billing_access: 0,
      can_create_reseller: can_create_reseller ? 1 : 0,
      // Sidebar permissions - keep dashboard always on
      sidebar_dashboard: 1,
      sidebar_lead_manager: 0,
      sidebar_pipeline: 0,
      sidebar_inbox: 0,
      sidebar_lead_capture: 0,
      sidebar_workflows: 0,
      sidebar_automations: 0,
      sidebar_integrations: 0,
      sidebar_webhooks: 0,
      sidebar_app_marketing: 0,
      sidebar_analytics: 0,
      sidebar_reports: 0,
      sidebar_billing: 0,
      sidebar_api_docs: 0,
      sidebar_settings: 0,
      sidebar_user_management: 0,
      // Channel permissions
      channel_whatsapp: 0,
      channel_sms: 0,
      channel_rcs: 0,
      channel_email: 0,
      channel_voice: 0,
      channel_ai_calling: 0,
      channel_meta_ads: 0,
      channel_google_ads: 0,
      // Integration permissions
      integration_whatsapp: 0,
      integration_sms: 0,
      integration_rcs: 0,
      integration_email: 0,
      integration_voice: 0,
      integration_meta_ads: 0,
      integration_google_ads: 0,
      // Other
      team: team || null,
      updated_at: new Date(),
    };

    // Set feature permissions
    if (permissions && Array.isArray(permissions)) {
      permissions.forEach((perm: string) => {
        if (FEATURE_PERMISSION_KEYS.includes(perm as any)) {
          permissionUpdate[perm] = 1;
        }
      });
    }

    // Set sidebar / channel / integration permissions
    if (sidebar_permissions && Array.isArray(sidebar_permissions)) {
      sidebar_permissions.forEach((perm: string) => {
        if (perm === "sidebar_user_management" && userType === 5) {
          return; // Agents can't have user_management
        }
        if (ALL_GRANTABLE_SIDEBAR_KEYS.includes(perm as any)) {
          permissionUpdate[perm] = 1;
        }
      });
    }

    await db
      .updateTable("permissions")
      .set(permissionUpdate)
      .where("username", "=", existingUser.username)
      .execute();

    // Log activity
    await logActivity(req, {
      username: existingUser.username,
      action: "Update User",
      description: `User updated by ${currentUser.username}`,
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "User updated successfully",
      error: null,
      data: {
        id,
        firstname,
        lastname,
        email,
        phone,
        role: role ?? "user",
        userType,
        team,
      },
    });
  } catch (err) {
    req.log.error(err);
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
// 🔐 updateUserRoleClientManagement CONTROLLER
// ============================================================
export const updateUserRoleClientManagement = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // 🔐 Admin username from JWT
    const parentUsername = req.user?.username;

    if (!parentUsername) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "token_invalid",
      });
    }

    // 🆔 User ID from params
    const { id } = req.params as { id: string };

    // 📦 Body
    const { role } = req.body as { role: string };

    if (!role || !ROLE_MAP[role]) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Invalid role",
        error: "invalid_role",
      });
    }

    const userType = ROLE_MAP[role];

    // 🔐 Resolve the caller (need their user_type + email for scoping)
    let currentUser = await db
      .selectFrom("users")
      .select(["user_type", "username", "email"])
      .where("username", "=", parentUsername)
      .executeTakeFirst();
    if (!currentUser) {
      currentUser = await db
        .selectFrom("users")
        .select(["user_type", "username", "email"])
        .where("email", "=", parentUsername)
        .executeTakeFirst();
    }
    if (!currentUser) {
      return reply.status(401).send({
        status: 0, statuscode: 401, message: "Current user not found", error: "user_not_found",
      });
    }

    // 🔐 Ownership: only super-admin may touch anyone; everyone else only the
    // users they created (parent_username = them). Prevents cross-tenant edits.
    let userQuery = db
      .selectFrom("users")
      .select(["id", "username"])
      .where("id", "=", Number(id));
    if (currentUser.user_type !== 1) {
      userQuery = userQuery.where((eb) =>
        eb.or([
          eb("parent_username", "=", parentUsername),
          eb("parent_username", "=", currentUser!.username),
          eb("parent_username", "=", currentUser!.email || ""),
        ]),
      );
    }
    const user = await userQuery.executeTakeFirst();

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "not_found",
      });
    }

    // 🔐 Role hierarchy: caller can only assign roles they're allowed to create.
    // Without this, any caller could promote a user to super-admin (escalation).
    const parentPermissions = await getAllPermissions(currentUser.username);
    const canCreateResellerBool = parentPermissions?.can_create_reseller === 1;
    const allowedUserTypes = getAllowedUserTypes(currentUser.user_type, canCreateResellerBool);
    if (!allowedUserTypes.includes(userType)) {
      return reply.status(403).send({
        status: 0,
        statuscode: 403,
        message: `You don't have permission to assign the ${role} role`,
        error: "permission_denied",
      });
    }

    // 🔄 Update role (USERNAME NOT TOUCHED)
    await db
      .updateTable("users")
      .set({
        user_type: userType,
        updated_at: new Date(),
      })
      .where("id", "=", Number(id))
      .execute();

    // 📝 Log activity
    await logActivity(req, {
      username: user.username,
      action: "Update Role",
      description: `Role changed to ${role} by ${parentUsername}`,
    });

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "User role updated successfully",
      data: {
        id,
        role,
        user_type: userType,
      },
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
    });
  }
};

// ============================================================
// 🔐 getOverviewUsers CONTROLLER
// ============================================================

export const getOverviewUsers = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const username = req.user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "token_invalid",
      });
    }

    // 🔍 Get current user info for flexible parent_username matching
    let currentUser = await db
      .selectFrom("users")
      .select(["user_type", "username", "email"])
      .where("username", "=", username)
      .executeTakeFirst();

    // If direct username lookup fails, try email lookup
    if (!currentUser) {
      currentUser = await db
        .selectFrom("users")
        .select(["user_type", "username", "email"])
        .where("email", "=", username)
        .executeTakeFirst();

      if (!currentUser) {
        return reply.status(401).send({
          status: 0,
          statuscode: 401,
          message: "Current user not found",
          error: "user_not_found",
        });
      }
    }

    // 🔹 Role-wise count - use flexible parent_username matching
    const roleRows = await db
      .selectFrom("users")
      .select(["user_type", db.fn.count("id").as("count")])
      .where((eb) =>
        eb.or([
          eb("parent_username", "=", username), // Token username
          eb("parent_username", "=", currentUser.username), // Actual DB username
          eb("parent_username", "=", currentUser.email || ""), // Email
        ]),
      )
      .groupBy("user_type")
      .execute();

    let admins = 0;
    let resellers = 0;
    let users = 0;
    let agents = 0;

    for (const row of roleRows) {
      switch (row.user_type) {
        case 2:
          admins = Number(row.count);
          break;
        case 3:
          resellers = Number(row.count);
          break;
        case 4:
          users = Number(row.count);
          break;
        case 5:
          agents = Number(row.count);
          break;
      }
    }

    // 🔹 Status-wise count - use flexible parent_username matching
    const statusRows = await db
      .selectFrom("users")
      .select(["is_active", db.fn.count("id").as("count")])
      .where((eb) =>
        eb.or([
          eb("parent_username", "=", username), // Token username
          eb("parent_username", "=", currentUser.username), // Actual DB username
          eb("parent_username", "=", currentUser.email || ""), // Email
        ]),
      )
      .groupBy("is_active")
      .execute();

    let enable = 0;
    let disable = 0;

    for (const row of statusRows) {
      if (row.is_active === 1) {
        enable = Number(row.count);
      }
      if (row.is_active === 0) {
        disable = Number(row.count);
      }
    }

    const total = enable + disable;

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "User overview fetched successfully",
      data: {
        total,
        enable,
        disable,
        admins,
        resellers,
        agents,
        users,
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error",
    });
  }
};

// ============================================================
// 🔐 DisableAnableStaus CONTROLLER
// ============================================================

export const toggleUserStatus = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const admin = req.user;
    // Authorization is enforced below by scoping the target user to the
    // caller's hierarchy (parent_username match).

    const { id } = req.params as { id: string };
    const { status } = req.body as { status: "enable" | "disable" };

    const STATUS_MAP = {
      enable: 1,
      disable: 0,
    };

    if (STATUS_MAP[status] === undefined) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Invalid status value",
      });
    }

    // Get current admin info for flexible parent_username matching
    let currentAdmin = await db
      .selectFrom("users")
      .select(["username", "email"])
      .where("username", "=", admin.username)
      .executeTakeFirst();

    // If direct username lookup fails, try email lookup
    if (!currentAdmin) {
      currentAdmin = await db
        .selectFrom("users")
        .select(["username", "email"])
        .where("email", "=", admin.username)
        .executeTakeFirst();
    }

    if (!currentAdmin) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Admin user not found",
        error: "admin_not_found",
      });
    }

    const user = await db
      .selectFrom("users")
      .select(["id", "username"])
      .where("id", "=", Number(id))
      .where((eb) =>
        eb.or([
          eb("parent_username", "=", admin.username), // Token username
          eb("parent_username", "=", currentAdmin.username), // Actual DB username
          eb("parent_username", "=", currentAdmin.email || ""), // Email
        ]),
      )
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
      });
    }

    await db
      .updateTable("users")
      .set({
        is_active: STATUS_MAP[status],
        updated_at: new Date(),
      })
      .where("id", "=", Number(id))
      .execute();

    await logActivity(req, {
      username: user.username,
      action: "Update status",
      description: `Status changed to ${status} by ${admin.username}`,
    });

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "User status updated successfully",
      data: {
        id,
        status,
        is_active: STATUS_MAP[status],
      },
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
    });
  }
};

// ============================================================
// 🔐 creditDeductSms CONTROLLER
// ============================================================

export type BodyType = {
  amount: string;
  client_username: string;
  credits: string;
  operation: "credit" | "deduct" | "transfer";
  taxamt?: string;
  decrip?: string;
  name?: string;
  source_username?: string; // For user-to-user transfers
};

export const creditDeductSms = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // 🔐 Admin from token
    const adminUsername = req.user?.username;
    const adminUuid = req.user?.uuid;

    if (!adminUsername || !adminUuid) {
      return reply.status(401).send({
        status: 0,
        message: "Unauthorized",
      });
    }

    const {
      amount,
      client_username,
      credits,
      operation,
      taxamt,
      decrip,
      name,
      source_username,
    } = req.body as BodyType;

    const creditCount = Number(credits);
    const pricePerCreditNum = Number(amount);
    const pricePerCredit = amount;
    const totalAmount = creditCount * pricePerCreditNum;

    if (creditCount <= 0 || pricePerCreditNum <= 0) {
      return reply.status(400).send({
        status: 0,
        message: "Invalid credits or amount",
      });
    }

    // 🔍 Fetch client (target user)
    const client = await db
      .selectFrom("users")
      .select(["username", "sms_credits", "firstname", "lastname"])
      .where("username", "=", client_username)
      .executeTakeFirst();

    if (!client) {
      return reply.status(404).send({
        status: 0,
        message: "Target user not found",
      });
    }

    // 🔍 Fetch admin
    const admin = await db
      .selectFrom("users")
      .select(["username", "sms_credits", "user_type"])
      .where("username", "=", adminUsername)
      .executeTakeFirst();

    if (!admin) {
      return reply.status(404).send({
        status: 0,
        message: "Admin not found",
      });
    }

    // 🔍 Fetch source user (for transfer operation)
    let sourceUser = null;
    if (operation === "transfer" && source_username) {
      sourceUser = await db
        .selectFrom("users")
        .select(["username", "sms_credits", "firstname", "lastname"])
        .where("username", "=", source_username)
        .executeTakeFirst();

      if (!sourceUser) {
        return reply.status(404).send({
          status: 0,
          message: "Source user not found",
        });
      }
    }

    // 🌐 Meta info
    const ipAddress =
      req.headers["x-forwarded-for"]?.toString() || req.ip || "0.0.0.0";

    const deviceInfo = req.headers["user-agent"] || null;

    // =====================================================
    // 🔐 TRANSACTION START (MOST IMPORTANT FIX)
    // =====================================================
    await db.transaction().execute(async (trx) => {
      // ========================
      // CREDIT (Admin to Client)
      // ========================
      if (operation === "credit") {
        if (Number(admin.sms_credits || 0) < creditCount) {
          throw new Error("INSUFFICIENT_ADMIN_CREDITS");
        }

        // ➕ Client add
        await trx
          .updateTable("users")
          .set({
            sms_credits: sql`COALESCE(sms_credits, 0) + ${creditCount}`,
          })
          .where("username", "=", client_username)
          .execute();

        // ➖ Admin deduct
        await trx
          .updateTable("users")
          .set({
            sms_credits: sql`COALESCE(sms_credits, 0) - ${creditCount}`,
          })
          .where("username", "=", adminUsername)
          .execute();
      }

      // ========================
      // DEDUCT (Client to Admin)
      // ========================
      if (operation === "deduct") {
        if (Number(client.sms_credits || 0) < creditCount) {
          throw new Error("INSUFFICIENT_CLIENT_CREDITS");
        }

        // ➖ Client deduct
        await trx
          .updateTable("users")
          .set({
            sms_credits: sql`COALESCE(sms_credits, 0) - ${creditCount}`,
          })
          .where("username", "=", client_username)
          .execute();

        // ➕ Admin add
        await trx
          .updateTable("users")
          .set({
            sms_credits: sql`COALESCE(sms_credits, 0) + ${creditCount}`,
          })
          .where("username", "=", adminUsername)
          .execute();
      }

      // ========================
      // TRANSFER (User to User)
      // ========================
      if (operation === "transfer" && sourceUser) {
        if (Number(sourceUser.sms_credits || 0) < creditCount) {
          throw new Error("INSUFFICIENT_SOURCE_CREDITS");
        }

        // ➖ Source user deduct
        await trx
          .updateTable("users")
          .set({
            sms_credits: sql`COALESCE(sms_credits, 0) - ${creditCount}`,
          })
          .where("username", "=", source_username)
          .execute();

        // ➕ Target user add
        await trx
          .updateTable("users")
          .set({
            sms_credits: sql`COALESCE(sms_credits, 0) + ${creditCount}`,
          })
          .where("username", "=", client_username)
          .execute();
      }

      // ========================
      // FUND MANAGEMENT ENTRY
      // ========================
      let fundDescription = "";
      if (operation === "transfer") {
        fundDescription = `Transferred ${creditCount} SMS credits from ${source_username} to ${client_username}`;
      } else {
        fundDescription =
          decrip ||
          `${
            operation === "credit" ? "Credited" : "Deducted"
          } ${creditCount} SMS credits ${
            operation === "credit" ? "to" : "from"
          } ${client_username}`;
      }

      await trx
        .insertInto("funds_management")
        .values({
          sms: creditCount,
          pps: pricePerCredit,
          accex: adminUsername,
          amt: totalAmount,
          cd: operation === "credit" || operation === "transfer" ? "CR" : "DR",
          user_type: admin.user_type,
          user_type_name: adminUsername,
          taxamt: taxamt || "0",
          decrip: fundDescription,
          name:
            operation === "transfer"
              ? `${source_username} → ${client_username}`
              : client_username,
        })
        .execute();

      // ========================
      // ACTIVITY LOG
      // ========================
      let activityDescription = "";
      if (operation === "transfer") {
        activityDescription = `Admin ${adminUsername} transferred ${creditCount} SMS credits from ${source_username} to ${client_username} @ ${pricePerCredit} (Total ${totalAmount})`;
      } else {
        activityDescription = `Admin ${adminUsername} ${operation}ed ${creditCount} SMS credits ${
          operation === "credit" ? "to" : "from"
        } ${client_username} @ ${pricePerCredit} (Total ${totalAmount})`;
      }

      await logActivity(req, {
        username: adminUsername,
        uuid: adminUuid,
        action:
          operation === "transfer"
            ? "SMS_TRANSFER"
            : operation === "credit"
              ? "SMS_CREDIT"
              : "SMS_DEDUCT",
        description: activityDescription,
        ip_address: ipAddress,
        device_info: deviceInfo,
      });
    });

    // ✅ SUCCESS - Calculate final balances
    let responseData: any = {
      client_username,
      admin_username: adminUsername,
      credits: creditCount,
      price_per_credit: pricePerCredit,
      total_amount: totalAmount,
      operation,
    };

    if (operation === "transfer" && sourceUser) {
      responseData = {
        ...responseData,
        source_username,
        source_SMS_Credits: (sourceUser.sms_credits || 0) - creditCount,
        target_SMS_Credits: (client.sms_credits || 0) + creditCount,
      };
    } else {
      responseData = {
        ...responseData,
        client_SMS_Credits:
          operation === "credit"
            ? (client.sms_credits || 0) + creditCount
            : (client.sms_credits || 0) - creditCount,
        admin_SMS_Credits:
          operation === "credit"
            ? (admin.sms_credits || 0) - creditCount
            : (admin.sms_credits || 0) + creditCount,
      };
    }

    return reply.send({
      status: 1,
      message: `SMS credits ${operation === "transfer" ? "transferred" : operation + "ed"} successfully`,
      data: responseData,
    });
  } catch (error: any) {
    req.log.error(error);

    if (error.message === "INSUFFICIENT_ADMIN_CREDITS") {
      return reply.status(400).send({
        status: 0,
        message: "Insufficient admin credits",
      });
    }

    if (error.message === "INSUFFICIENT_CLIENT_CREDITS") {
      return reply.status(400).send({
        status: 0,
        message: "Insufficient client credits",
      });
    }

    if (error.message === "INSUFFICIENT_SOURCE_CREDITS") {
      return reply.status(400).send({
        status: 0,
        message: "Insufficient source user credits",
      });
    }

    return reply.status(500).send({
      status: 0,
      message: "Internal server error",
    });
  }
};

// ============================================================
// 🔄 GET ALL TRANSACTION CONTROLLER
// ============================================================

export const getAllTransaction = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // 🔐 username from JWT (admin/reseller)
    const adminUsername = req.user?.username;

    if (!adminUsername) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "unauthorized",
        validation: null,
      });
    }

    // 📥 Query params
    const {
      user,
      start_date,
      end_date,
      limit = 10,
      page = 1,
      search,
      type, // 'credit' or 'debit'
      amount,
    } = req.query as {
      user?: string;
      start_date?: string;
      end_date?: string;
      limit?: number | string;
      page?: number | string;
      search?: string;
      type?: string;
      amount?: string;
    };

    if (!user) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "User parameter is required",
        error: "missing_user",
        validation: null,
      });
    }

    const limitNum = Number(limit) || 10;
    const pageNum = Number(page) || 1;
    const offset = (pageNum - 1) * limitNum;

    // 🔍 Base query
    let query = db
      .selectFrom("funds_management")
      .select([
        "id",
        "created_at",
        sql`CASE WHEN cd = 'CR' THEN 'Credit' ELSE 'Debit' END`.as("cd"),
        sql`user_type_name`.as("user_type_name"),
        "name",
        "sms",
        "pps",
        "amt",
        "user_type",
        sql`'SMS'`.as("service"),
        "decrip",
      ])
      .where("name", "like", `%${user}%`) // Assuming name contains the username or full name
      .orderBy("created_at", "desc");

    // 🎯 Filters
    if (search && search.trim() !== "") {
      query = query.where((eb) =>
        eb.or([
          eb("name", "like", `%${search}%`),
          eb("user_type_name", "like", `%${search}%`),
          eb("decrip", "like", `%${search}%`),
        ]),
      );
    }

    if (type) {
      const cdValue = type === "credit" ? "CR" : "DR";
      query = query.where("cd", "=", cdValue);
    }

    if (amount) {
      query = query.where("amt", "=", amount);
    }

    // 🎯 Date filters
    if (start_date) {
      query = query.where("created_at", ">=", new Date(start_date));
    }
    if (end_date) {
      query = query.where("created_at", "<=", new Date(end_date + " 23:59:59"));
    }

    // 🔢 Total count
    const countResult = await query
      .clearSelect()
      .select(db.fn.count("id").as("total"))
      .executeTakeFirst();

    const total = Number(countResult?.total || 0);

    // 📦 Paginated data
    const transactions = await query.limit(limitNum).offset(offset).execute();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Transactions fetched successfully",
      error: null,
      validation: null,
      data: {
        transactions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          total_pages: Math.ceil(total / limitNum),
        },
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
// 🔄 EXPORT TRANSACTION CONTROLLER
// ============================================================

export const exportTransactions = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    // 🔐 username from JWT
    const adminUsername = req.user?.username;

    if (!adminUsername) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "unauthorized",
        validation: null,
      });
    }

    // 📥 Query params (NO pagination here)
    const { user, start_date, end_date, search, type, amount } = req.query as {
      user?: string;
      start_date?: string;
      end_date?: string;
      search?: string;
      type?: string;
      amount?: string;
    };

    if (!user) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "User parameter is required",
        error: "missing_user",
        validation: null,
      });
    }

    // 🔍 Base query (same as list API)
    let query = db
      .selectFrom("funds_management")
      .select([
        "id",
        "created_at",
        sql`CASE WHEN cd = 'CR' THEN 'Credit' ELSE 'Debit' END`.as("cd"),
        sql`user_type_name`.as("user_type_name"),
        "name",
        "sms",
        "pps",
        "amt",
        "user_type",
        sql`'SMS'`.as("service"),
        "decrip",
      ])
      .where("name", "like", `%${user}%`)
      .orderBy("created_at", "desc");

    // 🔎 Search filter
    if (search && search.trim() !== "") {
      query = query.where((eb) =>
        eb.or([
          eb("name", "like", `%${search}%`),
          eb("user_type_name", "like", `%${search}%`),
          eb("decrip", "like", `%${search}%`),
        ]),
      );
    }

    // 🔁 Credit / Debit filter
    if (type) {
      const cdValue = type === "credit" ? "CR" : "DR";
      query = query.where("cd", "=", cdValue);
    }

    // 💰 Amount filter
    if (amount) {
      query = query.where("amt", "=", amount);
    }

    // 📅 Date filters
    if (start_date) {
      query = query.where("created_at", ">=", new Date(start_date));
    }
    if (end_date) {
      query = query.where("created_at", "<=", new Date(end_date + " 23:59:59"));
    }

    // 📦 FETCH ALL (NO LIMIT)
    const transactions = await query.execute();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Transactions exported successfully",
      error: null,
      validation: null,
      data: {
        transactions,
        total: transactions.length,
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

export const getCurrentUserPermissions = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const username = req.user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "token_invalid",
      });
    }

    const user = await db
      .selectFrom("users")
      .select(["user_type", "username"])
      .where("username", "=", username)
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "not_found",
      });
    }

    // Super admin and admin get full permissions
    const isAdmin = user.user_type <= 2;

    let permissions = await getAllPermissions(user.username);
    if (!permissions) {
      permissions = getDefaultPermissions();
    }

    // Calculate grantable permissions
    const grantableFeaturePermissions = getGrantableFeaturePermissions(
      permissions,
      user.user_type,
    );
    const grantableSidebarPermissions = getGrantableSidebarPermissions(
      permissions,
      user.user_type,
    );

    // Get allowed roles
    const canCreateReseller = permissions.can_create_reseller === 1;
    const allowedUserTypes = getAllowedUserTypes(
      user.user_type,
      canCreateReseller,
    );
    const allowedRoles = userTypesToRoles(allowedUserTypes);

    // Can this user grant can_create_reseller?
    const canGrantResellerCreation =
      user.user_type === 1 ||
      (user.user_type <= 3 && permissions.can_create_reseller === 1);

    // Does this user have user management access?
    const hasUserManagementAccess = canAccessUserManagement(user.user_type);

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Permissions fetched successfully",
      data: {
        user_type: user.user_type,
        is_admin: isAdmin,

        // Current user's own permissions
        feature_permissions: {
          create_client: permissions.create_client,
          view_leads: permissions.view_leads,
          edit_leads: permissions.edit_leads,
          manage_users: permissions.manage_users,
          view_reports: permissions.view_reports,
          manage_automations: permissions.manage_automations,
          billing_access: permissions.billing_access,
          can_create_reseller: permissions.can_create_reseller,
        },

        sidebar_permissions: {
          sidebar_dashboard: permissions.sidebar_dashboard,
          sidebar_lead_manager: permissions.sidebar_lead_manager,
          sidebar_pipeline: permissions.sidebar_pipeline,
          sidebar_inbox: permissions.sidebar_inbox,
          sidebar_lead_capture: permissions.sidebar_lead_capture,
          sidebar_workflows: permissions.sidebar_workflows,
          sidebar_automations: permissions.sidebar_automations,
          sidebar_integrations: permissions.sidebar_integrations,
          sidebar_webhooks: permissions.sidebar_webhooks,
          sidebar_app_marketing: permissions.sidebar_app_marketing,
          sidebar_analytics: permissions.sidebar_analytics,
          sidebar_reports: permissions.sidebar_reports,
          sidebar_billing: permissions.sidebar_billing,
          sidebar_api_docs: permissions.sidebar_api_docs,
          sidebar_settings: permissions.sidebar_settings,
          sidebar_user_management: permissions.sidebar_user_management,
        },

        channel_permissions: {
          channel_whatsapp: permissions.channel_whatsapp,
          channel_sms: permissions.channel_sms,
          channel_rcs: permissions.channel_rcs,
          channel_email: permissions.channel_email,
          channel_voice: permissions.channel_voice,
          channel_ai_calling: permissions.channel_ai_calling,
          channel_meta_ads: permissions.channel_meta_ads,
          channel_google_ads: permissions.channel_google_ads,
        },

        integration_permissions: {
          integration_whatsapp: permissions.integration_whatsapp,
          integration_sms: permissions.integration_sms,
          integration_rcs: permissions.integration_rcs,
          integration_email: permissions.integration_email,
          integration_voice: permissions.integration_voice,
          integration_meta_ads: permissions.integration_meta_ads,
          integration_google_ads: permissions.integration_google_ads,
        },

        // What this user CAN grant to others
        grantable: {
          roles: allowedRoles,
          feature_permissions: grantableFeaturePermissions,
          sidebar_permissions: grantableSidebarPermissions,
          can_grant_reseller_creation: canGrantResellerCreation,
        },

        // Access flags
        has_user_management_access: hasUserManagementAccess,
      },
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
    });
  }
};

export const getSidebarConfig = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const username = req.user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "token_invalid",
      });
    }

    const user = await db
      .selectFrom("users")
      .select(["user_type", "username"])
      .where("username", "=", username)
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "User not found",
        error: "not_found",
      });
    }

    // Super admin and admin get all sidebar access
    if (user.user_type <= 2) {
      const allSidebarItems: Record<string, boolean> = {};
      SIDEBAR_PERMISSION_KEYS.forEach((key) => {
        const cleanKey = key.replace("sidebar_", "");
        allSidebarItems[cleanKey] = true;
      });

      const allChannelPerms: Record<string, boolean> = {};
      CHANNEL_PERMISSION_KEYS.forEach((key) => { allChannelPerms[key] = true; });

      const allIntegrationPerms: Record<string, boolean> = {};
      INTEGRATION_PERMISSION_KEYS.forEach((key) => { allIntegrationPerms[key] = true; });

      return reply.status(200).send({
        status: 1,
        statuscode: 200,
        message: "Sidebar config fetched",
        data: {
          user_type: user.user_type,
          is_admin: true,
          sidebar_items: allSidebarItems,
          channel_permissions: allChannelPerms,
          integration_permissions: allIntegrationPerms,
        },
      });
    }

    // For other users, fetch from database
    const permissions = await getAllPermissions(user.username);
    const defaultPerms = getDefaultPermissions();
    const perms = permissions || defaultPerms;

    // Convert to boolean object with clean keys
    const sidebarItems: Record<string, boolean> = {};
    SIDEBAR_PERMISSION_KEYS.forEach((key) => {
      const cleanKey = key.replace("sidebar_", "");
      sidebarItems[cleanKey] = (perms as any)[key] === 1;
    });

    // Ensure agents don't have user_management
    if (user.user_type === 5) {
      sidebarItems.user_management = false;
    }

    const channelPerms: Record<string, boolean> = {};
    CHANNEL_PERMISSION_KEYS.forEach((key) => {
      channelPerms[key] = (perms as any)[key] === 1;
    });

    const integrationPerms: Record<string, boolean> = {};
    INTEGRATION_PERMISSION_KEYS.forEach((key) => {
      integrationPerms[key] = (perms as any)[key] === 1;
    });

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Sidebar config fetched",
      data: {
        user_type: user.user_type,
        is_admin: false,
        sidebar_items: sidebarItems,
        channel_permissions: channelPerms,
        integration_permissions: integrationPerms,
      },
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
    });
  }
};
