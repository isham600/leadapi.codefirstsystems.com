import { db } from "../../../models/db.js";

// ─── Types ──────────────────────────────────────────────────────────────────
export interface FeaturePermissions {
  create_client: number;
  view_leads: number;
  edit_leads: number;
  manage_users: number;
  view_reports: number;
  manage_automations: number;
  billing_access: number;
  can_create_reseller: number;
}

export interface SidebarPermissions {
  sidebar_dashboard: number;
  sidebar_lead_manager: number;
  sidebar_pipeline: number;
  sidebar_inbox: number;
  sidebar_lead_capture: number;
  sidebar_workflows: number;
  sidebar_automations: number;
  sidebar_integrations: number;
  sidebar_webhooks: number;
  sidebar_app_marketing: number;
  sidebar_analytics: number;
  sidebar_reports: number;
  sidebar_billing: number;
  sidebar_api_docs: number;
  sidebar_settings: number;
  sidebar_user_management: number;
}

export interface ChannelPermissions {
  channel_whatsapp: number;
  channel_sms: number;
  channel_rcs: number;
  channel_email: number;
  channel_voice: number;
  channel_ai_calling: number;
  channel_meta_ads: number;
  channel_google_ads: number;
}

export interface IntegrationPermissions {
  integration_whatsapp: number;
  integration_sms: number;
  integration_rcs: number;
  integration_email: number;
  integration_voice: number;
  integration_meta_ads: number;
  integration_google_ads: number;
}

export interface AllPermissions extends FeaturePermissions, SidebarPermissions, ChannelPermissions, IntegrationPermissions {
  team: string | null;
}

// ─── Permission Keys ────────────────────────────────────────────────────────
export const FEATURE_PERMISSION_KEYS = [
  "create_client",
  "view_leads",
  "edit_leads",
  "manage_users",
  "view_reports",
  "manage_automations",
  "billing_access",
] as const;

export const SIDEBAR_PERMISSION_KEYS = [
  "sidebar_dashboard",
  "sidebar_lead_manager",
  "sidebar_pipeline",
  "sidebar_inbox",
  "sidebar_lead_capture",
  "sidebar_workflows",
  "sidebar_automations",
  "sidebar_integrations",
  "sidebar_webhooks",
  "sidebar_app_marketing",
  "sidebar_analytics",
  "sidebar_reports",
  "sidebar_billing",
  "sidebar_api_docs",
  "sidebar_settings",
  "sidebar_user_management",
] as const;

export const CHANNEL_PERMISSION_KEYS = [
  "channel_whatsapp",
  "channel_sms",
  "channel_rcs",
  "channel_email",
  "channel_voice",
  "channel_ai_calling",
  "channel_meta_ads",
  "channel_google_ads",
] as const;

export const INTEGRATION_PERMISSION_KEYS = [
  "integration_whatsapp",
  "integration_sms",
  "integration_rcs",
  "integration_email",
  "integration_voice",
  "integration_meta_ads",
  "integration_google_ads",
] as const;

// All keys that can be set via sidebar_permissions array in request body
export const ALL_GRANTABLE_SIDEBAR_KEYS = [
  ...SIDEBAR_PERMISSION_KEYS,
  ...CHANNEL_PERMISSION_KEYS,
  ...INTEGRATION_PERMISSION_KEYS,
] as const;

// ─── Role Mapping ───────────────────────────────────────────────────────────
export const ROLE_MAP: Record<string, number> = {
  admin: 2,
  reseller: 3,
  user: 4,
  agent: 5,
};

export const USER_TYPE_TO_ROLE: Record<number, string> = {
  1: "superadmin",
  2: "admin",
  3: "reseller",
  4: "user",
  5: "agent",
};

// ─── Get Allowed User Types ─────────────────────────────────────────────────
export const getAllowedUserTypes = (
  currentUserType: number,
  canCreateReseller: boolean = false,
): number[] => {
  switch (currentUserType) {
    case 1: // Super Admin
      return [2, 3, 4, 5]; // Admin, Reseller, User, Agent
    case 2: // Admin
      return [3, 4, 5]; // Reseller, User, Agent
    case 3: // Reseller
      return canCreateReseller ? [3, 4, 5] : [4, 5]; // With permission: Reseller, User, Agent
    case 4: // User
      return [5]; // Agent only
    case 5: // Agent
      return []; // Cannot create users
    default:
      return [];
  }
};

// ─── Convert User Types to Role Names ───────────────────────────────────────
export const userTypesToRoles = (userTypes: number[]): string[] => {
  return userTypes.map((t) => USER_TYPE_TO_ROLE[t]).filter(Boolean);
};

// ─── Get All Permissions for a User ─────────────────────────────────────────
export const getAllPermissions = async (
  username: string,
): Promise<AllPermissions | null> => {
  const permissions = await db
    .selectFrom("permissions")
    .select([
      // Feature permissions
      "create_client",
      "view_leads",
      "edit_leads",
      "manage_users",
      "view_reports",
      "manage_automations",
      "billing_access",
      "can_create_reseller",
      // Sidebar permissions
      "sidebar_dashboard",
      "sidebar_lead_manager",
      "sidebar_pipeline",
      "sidebar_inbox",
      "sidebar_lead_capture",
      "sidebar_workflows",
      "sidebar_automations",
      "sidebar_integrations",
      "sidebar_webhooks",
      "sidebar_app_marketing",
      "sidebar_analytics",
      "sidebar_reports",
      "sidebar_billing",
      "sidebar_api_docs",
      "sidebar_settings",
      "sidebar_user_management",
      // Channel permissions
      "channel_whatsapp",
      "channel_sms",
      "channel_rcs",
      "channel_email",
      "channel_voice",
      "channel_ai_calling",
      "channel_meta_ads",
      "channel_google_ads",
      // Integration permissions
      "integration_whatsapp",
      "integration_sms",
      "integration_rcs",
      "integration_email",
      "integration_voice",
      "integration_meta_ads",
      "integration_google_ads",
      // Other
      "team",
    ])
    .where("username", "=", username)
    .executeTakeFirst();

  if (!permissions) return null;

  return {
    // Feature permissions
    create_client: permissions.create_client ?? 0,
    view_leads: permissions.view_leads ?? 0,
    edit_leads: permissions.edit_leads ?? 0,
    manage_users: permissions.manage_users ?? 0,
    view_reports: permissions.view_reports ?? 0,
    manage_automations: permissions.manage_automations ?? 0,
    billing_access: permissions.billing_access ?? 0,
    can_create_reseller: permissions.can_create_reseller ?? 0,
    // Sidebar permissions
    sidebar_dashboard: permissions.sidebar_dashboard ?? 1,
    sidebar_lead_manager: permissions.sidebar_lead_manager ?? 0,
    sidebar_pipeline: permissions.sidebar_pipeline ?? 0,
    sidebar_inbox: permissions.sidebar_inbox ?? 0,
    sidebar_lead_capture: permissions.sidebar_lead_capture ?? 0,
    sidebar_workflows: permissions.sidebar_workflows ?? 0,
    sidebar_automations: permissions.sidebar_automations ?? 0,
    sidebar_integrations: permissions.sidebar_integrations ?? 0,
    sidebar_webhooks: permissions.sidebar_webhooks ?? 0,
    sidebar_app_marketing: permissions.sidebar_app_marketing ?? 0,
    sidebar_analytics: permissions.sidebar_analytics ?? 0,
    sidebar_reports: permissions.sidebar_reports ?? 0,
    sidebar_billing: permissions.sidebar_billing ?? 0,
    sidebar_api_docs: permissions.sidebar_api_docs ?? 0,
    sidebar_settings: permissions.sidebar_settings ?? 0,
    sidebar_user_management: permissions.sidebar_user_management ?? 0,
    // Channel permissions
    channel_whatsapp: permissions.channel_whatsapp ?? 0,
    channel_sms: permissions.channel_sms ?? 0,
    channel_rcs: permissions.channel_rcs ?? 0,
    channel_email: permissions.channel_email ?? 0,
    channel_voice: permissions.channel_voice ?? 0,
    channel_ai_calling: permissions.channel_ai_calling ?? 0,
    channel_meta_ads: permissions.channel_meta_ads ?? 0,
    channel_google_ads: permissions.channel_google_ads ?? 0,
    // Integration permissions
    integration_whatsapp: permissions.integration_whatsapp ?? 0,
    integration_sms: permissions.integration_sms ?? 0,
    integration_rcs: permissions.integration_rcs ?? 0,
    integration_email: permissions.integration_email ?? 0,
    integration_voice: permissions.integration_voice ?? 0,
    integration_meta_ads: permissions.integration_meta_ads ?? 0,
    integration_google_ads: permissions.integration_google_ads ?? 0,
    // Other
    team: permissions.team ?? null,
  };
};

// ─── Get Default Permissions ────────────────────────────────────────────────
export const getDefaultPermissions = (): AllPermissions => ({
  create_client: 0,
  view_leads: 0,
  edit_leads: 0,
  manage_users: 0,
  view_reports: 0,
  manage_automations: 0,
  billing_access: 0,
  can_create_reseller: 0,
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
  channel_whatsapp: 0,
  channel_sms: 0,
  channel_rcs: 0,
  channel_email: 0,
  channel_voice: 0,
  channel_ai_calling: 0,
  channel_meta_ads: 0,
  channel_google_ads: 0,
  integration_whatsapp: 0,
  integration_sms: 0,
  integration_rcs: 0,
  integration_email: 0,
  integration_voice: 0,
  integration_meta_ads: 0,
  integration_google_ads: 0,
  team: null,
});

// ─── Validate Feature Permission Grants ─────────────────────────────────────
export const validateFeaturePermissionGrant = (
  parentPermissions: AllPermissions,
  requestedPermissions: string[],
  parentUserType: number,
): { valid: boolean; error?: string; unauthorized?: string[] } => {
  // Super admin can grant any permission
  if (parentUserType === 1) {
    return { valid: true };
  }

  const unauthorized: string[] = [];

  for (const perm of requestedPermissions) {
    // Handle can_create_reseller separately
    if (perm === "can_create_reseller") {
      // Only Admin (user_type 1, 2) can grant this
      if (parentUserType > 2) {
        unauthorized.push(perm);
      } else if (parentPermissions.can_create_reseller !== 1) {
        unauthorized.push(perm);
      }
      continue;
    }

    const permKey = perm as keyof FeaturePermissions;
    if (FEATURE_PERMISSION_KEYS.includes(perm as any)) {
      if (parentPermissions[permKey] !== 1) {
        unauthorized.push(perm);
      }
    }
  }

  if (unauthorized.length > 0) {
    return {
      valid: false,
      error: `You cannot grant these permissions: ${unauthorized.join(", ")}`,
      unauthorized,
    };
  }

  return { valid: true };
};

// ─── Validate Sidebar Permission Grants ─────────────────────────────────────
export const validateSidebarPermissionGrant = (
  parentPermissions: AllPermissions,
  requestedPermissions: string[],
  parentUserType: number,
  targetUserType: number,
): { valid: boolean; error?: string; unauthorized?: string[] } => {
  // Super admin can grant any sidebar permission
  if (parentUserType === 1) {
    return { valid: true };
  }

  const unauthorized: string[] = [];

  for (const perm of requestedPermissions) {
    // Agents cannot have user_management
    if (perm === "sidebar_user_management" && targetUserType === 5) {
      unauthorized.push(perm);
      continue;
    }

    if (ALL_GRANTABLE_SIDEBAR_KEYS.includes(perm as any)) {
      const permKey = perm as keyof AllPermissions;
      if (parentPermissions[permKey] !== 1) {
        unauthorized.push(perm);
      }
    }
  }

  if (unauthorized.length > 0) {
    return {
      valid: false,
      error: `You cannot grant these permissions: ${unauthorized.join(", ")}`,
      unauthorized,
    };
  }

  return { valid: true };
};

// ─── Check User Management Access ───────────────────────────────────────────
export const canAccessUserManagement = (userType: number): boolean => {
  // Agents (5) cannot access user management
  return userType !== 5;
};

// ─── Get Grantable Feature Permissions ──────────────────────────────────────
export const getGrantableFeaturePermissions = (
  parentPermissions: AllPermissions,
  parentUserType: number,
): string[] => {
  // Super admin can grant all
  if (parentUserType === 1) {
    return [...FEATURE_PERMISSION_KEYS, "can_create_reseller"];
  }

  const grantable: string[] = [];

  for (const perm of FEATURE_PERMISSION_KEYS) {
    if (parentPermissions[perm] === 1) {
      grantable.push(perm);
    }
  }

  // Only Admin (1, 2) can grant can_create_reseller
  if (parentUserType <= 2 && parentPermissions.can_create_reseller === 1) {
    grantable.push("can_create_reseller");
  }

  return grantable;
};

// ─── Get Grantable Sidebar Permissions ──────────────────────────────────────
export const getGrantableSidebarPermissions = (
  parentPermissions: AllPermissions,
  parentUserType: number,
): string[] => {
  // Super admin can grant all
  if (parentUserType === 1) {
    return [...ALL_GRANTABLE_SIDEBAR_KEYS];
  }

  const grantable: string[] = [];

  for (const perm of ALL_GRANTABLE_SIDEBAR_KEYS) {
    const permKey = perm as keyof AllPermissions;
    if (parentPermissions[permKey] === 1) {
      grantable.push(perm);
    }
  }

  return grantable;
};
