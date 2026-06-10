// src/rbac/roleHierarchy.ts

import { ROLE } from "./roles.js";

/**
 * Which role can CREATE which roles
 */
export const ROLE_CREATE_PERMISSION: Record<ROLE, ROLE[]> = {
  [ROLE.SUPER_ADMIN]: [ROLE.ADMIN, ROLE.RESELLER, ROLE.AGENT, ROLE.USER],
  [ROLE.ADMIN]: [ROLE.RESELLER, ROLE.AGENT, ROLE.USER],
  [ROLE.RESELLER]: [ROLE.AGENT, ROLE.USER],
  [ROLE.USER]: [],
  [ROLE.AGENT]: [],
  
};

/**
 * Role power comparison
 * Smaller number = higher power
 */
export const hasHigherPower = (actor: ROLE, target: ROLE) => {
  return actor < target;
};
