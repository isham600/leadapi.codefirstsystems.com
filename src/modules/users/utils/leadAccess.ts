import type { FastifyRequest } from "fastify";
import { db } from "../../../models/db.js";

/**
 * Ownership guard for lead sub-resources (followups, communication,
 * activities, calls, notes …). Returns true only if the authenticated user
 * may access the given lead. Without this, any logged-in user could read
 * another tenant's lead data by walking the numeric id (IDOR).
 *
 * Mirrors the getLeads scoping rules:
 *  - normal users: lead.username must equal their username
 *  - agents (user_type=5): lead lives under the parent account AND must be
 *    assigned to the agent
 */
export async function canAccessLead(req: FastifyRequest, leadId: number): Promise<boolean> {
  const username = req.user?.username;
  if (!username || !Number.isFinite(leadId) || leadId <= 0) return false;

  const userType = (req.user as any)?.user_type as number | undefined;

  let accountUsername = username;
  let agentFilter: string | null = null;
  if (userType === 5) {
    const parent: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    accountUsername = parent?.parent_username ?? username;
    agentFilter = username;
  }

  let q = (db as any)
    .selectFrom("leads")
    .select(["id"])
    .where("id", "=", leadId)
    .where("username", "=", accountUsername);
  if (agentFilter) q = q.where("assigned_agent", "=", agentFilter);

  const row = await q.executeTakeFirst();
  return !!row;
}
