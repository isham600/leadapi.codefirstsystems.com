/**
 * pricing.service.ts
 * Pricing profile helpers — inheritance validation and effective rate lookup.
 *
 * Hierarchy: Admin → Reseller → Sub-reseller → User
 * Rule: child rate >= parent rate (no under-cutting).
 */

import { db } from "../../../models/db.js";

export interface PricingProfileInput {
  username:          string;
  channel:           string;
  category:          string;
  ratePerUnit:       number;
  connectionCharge:  number;
  pulseSeconds:      number;
  durationRate:      number;
  aiProcessingCost:  number;
  cpc:               number;
  cpl:               number;
  billingMode:       "submission" | "delivery";
  billOnSent:        number;
  billOnDelivered:   number;
  billOnRead:        number;
  billOnFailed:      number;
  billOnBlocked:     number;
  refundOnFailed:    number;
  refundOnBlocked:   number;
  createdBy:         string;
}

/**
 * Get the parent username for a given user.
 * Returns null for top-level admins.
 */
async function getParentUsername(username: string): Promise<string | null> {
  const row: any = await (db as any)
    .selectFrom("users")
    .select(["parent_username"])
    .where("username", "=", username)
    .executeTakeFirst();
  return row?.parent_username ?? null;
}

/**
 * Get the pricing profile for a specific user + channel + category.
 * Returns null if not set.
 */
export async function getProfile(
  username: string,
  channel:  string,
  category: string,
): Promise<any | null> {
  return (db as any)
    .selectFrom("pricing_profiles")
    .selectAll()
    .where("username", "=", username)
    .where("channel",  "=", channel)
    .where("category", "=", category)
    .where("is_active", "=", 1)
    .executeTakeFirst();
}

/**
 * Walk up the hierarchy to find the first ancestor that has a pricing profile.
 */
export async function getParentProfile(
  username: string,
  channel:  string,
  category: string,
): Promise<any | null> {
  let current = username;
  // Safety: max 10 levels deep
  for (let i = 0; i < 10; i++) {
    const parent = await getParentUsername(current);
    if (!parent) return null;
    const profile = await getProfile(parent, channel, category);
    if (profile) return profile;
    current = parent;
  }
  return null;
}

/**
 * Validate that the child's rates are >= parent's rates.
 * Throws a descriptive error if any rate undercuts the parent.
 */
export async function validateRatesAgainstParent(
  input: PricingProfileInput,
): Promise<void> {
  const parentProfile = await getParentProfile(
    input.username,
    input.channel,
    input.category,
  );
  if (!parentProfile) return; // top-level user — no constraint

  const checks: Array<{ field: string; child: number; parent: number }> = [
    { field: "rate_per_unit",      child: input.ratePerUnit,      parent: parseFloat(String(parentProfile.rate_per_unit)) },
    { field: "connection_charge",  child: input.connectionCharge, parent: parseFloat(String(parentProfile.connection_charge)) },
    { field: "duration_rate",      child: input.durationRate,     parent: parseFloat(String(parentProfile.duration_rate)) },
    { field: "ai_processing_cost", child: input.aiProcessingCost, parent: parseFloat(String(parentProfile.ai_processing_cost)) },
    { field: "cpc",                child: input.cpc,              parent: parseFloat(String(parentProfile.cpc)) },
    { field: "cpl",                child: input.cpl,              parent: parseFloat(String(parentProfile.cpl)) },
  ];

  for (const check of checks) {
    if (check.child < check.parent) {
      throw new Error(
        `${check.field} (${check.child}) cannot be lower than parent rate (${check.parent})`
      );
    }
  }
}

/**
 * Resolve the effective pricing profile for a user.
 * Walks up the hierarchy until a profile is found.
 * Returns null if no profile anywhere in the chain.
 */
export async function resolveEffectiveProfile(
  username: string,
  channel:  string,
  category: string,
): Promise<any | null> {
  let current = username;
  for (let i = 0; i < 10; i++) {
    const profile = await getProfile(current, channel, category);
    if (profile) return profile;
    const parent = await getParentUsername(current);
    if (!parent) return null;
    current = parent;
  }
  return null;
}
