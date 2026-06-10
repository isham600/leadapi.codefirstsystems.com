// src/rbac/rbac.helper.ts

import { ROLE } from "./roles.js";
import { ROLE_CREATE_PERMISSION, hasHigherPower } from "./roleHierarchy.js";

/**
 * Check if a user can create a target role
 */
export const canCreateRole = (
  creatorRole: ROLE,
  targetRole: ROLE
): boolean => {
  return ROLE_CREATE_PERMISSION[creatorRole]?.includes(targetRole);
};

/**
 * Check impersonation permission
 */
export const canImpersonate = (
  actorRole: ROLE,
  targetRole: ROLE
): boolean => {
  // Actor must be strictly higher
  return hasHigherPower(actorRole, targetRole);
};
