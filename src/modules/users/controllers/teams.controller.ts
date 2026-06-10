import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { sql } from "kysely";
import crypto from "crypto";

function getUsername(req: FastifyRequest): string | null {
  return (req as any).user?.username ?? null;
}

// ── List all teams with member count ──────────────────────────────────────────
export const getTeams = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = getUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  try {
    const teams = await (db as any)
      .selectFrom("teams")
      .where("username", "=", username)
      .selectAll()
      .orderBy("created_at", "asc")
      .execute();

    // Get member counts per team (no JOIN — avoids collation issues)
    const counts: any[] = await (db as any)
      .selectFrom("team_members")
      .where(sql`owner_username`, "=", username)
      .select(["team_id", sql`COUNT(*)`.as("member_count")])
      .groupBy("team_id")
      .execute();

    const countMap: Record<string, number> = {};
    for (const c of counts) countMap[c.team_id] = Number(c.member_count);

    const data = teams.map((t: any) => ({
      ...t,
      member_count: countMap[t.team_id] ?? 0,
    }));

    return reply.send({ status: 1, data });
  } catch (err: any) {
    console.error("[teams] getTeams:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to fetch teams" });
  }
};

// ── Create team ───────────────────────────────────────────────────────────────
export const createTeam = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = getUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { name, description } = req.body as { name: string; description?: string };
  if (!name?.trim()) return reply.status(400).send({ status: 0, message: "Team name is required" });

  try {
    const team_id = crypto.randomUUID();
    await (db as any).insertInto("teams").values({
      team_id,
      username,
      name: name.trim(),
      description: description?.trim() ?? null,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    return reply.send({ status: 1, message: "Team created", data: { team_id, name: name.trim() } });
  } catch (err: any) {
    console.error("[teams] createTeam:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to create team" });
  }
};

// ── Update team ───────────────────────────────────────────────────────────────
export const updateTeam = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = getUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { team_id } = req.params as { team_id: string };
  const { name, description } = req.body as { name?: string; description?: string };

  try {
    const existing = await (db as any).selectFrom("teams")
      .where("team_id", "=", team_id).where("username", "=", username)
      .selectAll().executeTakeFirst();
    if (!existing) return reply.status(404).send({ status: 0, message: "Team not found" });

    await (db as any).updateTable("teams")
      .set({
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(description !== undefined ? { description: description?.trim() ?? null } : {}),
        updated_at: new Date(),
      })
      .where("team_id", "=", team_id)
      .execute();

    return reply.send({ status: 1, message: "Team updated" });
  } catch (err: any) {
    console.error("[teams] updateTeam:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to update team" });
  }
};

// ── Delete team ───────────────────────────────────────────────────────────────
export const deleteTeam = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = getUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { team_id } = req.params as { team_id: string };

  try {
    await (db as any).deleteFrom("team_members").where("team_id", "=", team_id).execute();
    await (db as any).deleteFrom("teams")
      .where("team_id", "=", team_id).where("username", "=", username).execute();

    return reply.send({ status: 1, message: "Team deleted" });
  } catch (err: any) {
    console.error("[teams] deleteTeam:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to delete team" });
  }
};

// ── Get team members ──────────────────────────────────────────────────────────
export const getTeamMembers = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = getUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { team_id } = req.params as { team_id: string };

  try {
    const rows: any[] = await (db as any)
      .selectFrom("team_members")
      .where("team_id", "=", team_id)
      .where("owner_username", "=", username)
      .select(["id", "agent_username", "created_at"])
      .orderBy("created_at", "asc")
      .execute();

    // Enrich with user details — separate query avoids collation mismatch
    const usernames = rows.map((r) => r.agent_username);
    let userMap: Record<string, any> = {};
    if (usernames.length > 0) {
      const users: any[] = await (db as any)
        .selectFrom("users")
        .where(sql`username`, "in", usernames)
        .select(["username", "firstname", "lastname", "email"])
        .execute();
      for (const u of users) userMap[u.username] = u;
    }

    const members = rows.map((r) => ({
      id: r.id,
      agent_username: r.agent_username,
      firstname: userMap[r.agent_username]?.firstname ?? null,
      lastname:  userMap[r.agent_username]?.lastname  ?? null,
      email:     userMap[r.agent_username]?.email     ?? null,
      created_at: r.created_at,
    }));

    return reply.send({ status: 1, data: members });
  } catch (err: any) {
    console.error("[teams] getTeamMembers:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to fetch members" });
  }
};

// ── Add agent to team ─────────────────────────────────────────────────────────
export const addTeamMember = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = getUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { team_id } = req.params as { team_id: string };
  const { agent_username } = req.body as { agent_username: string };

  if (!agent_username) return reply.status(400).send({ status: 0, message: "agent_username is required" });

  try {
    // Verify team belongs to this user
    const team = await (db as any).selectFrom("teams")
      .where("team_id", "=", team_id).where("username", "=", username)
      .selectAll().executeTakeFirst();
    if (!team) return reply.status(404).send({ status: 0, message: "Team not found" });

    // Verify agent belongs to this account (any sub-user: agent or user)
    const agent = await (db as any).selectFrom("users")
      .where("username", "=", agent_username)
      .where("parent_username", "=", username)
      .selectAll().executeTakeFirst();
    if (!agent) return reply.status(404).send({ status: 0, message: "Agent not found" });

    // Check if already a member
    const exists = await (db as any).selectFrom("team_members")
      .where("team_id", "=", team_id).where("agent_username", "=", agent_username)
      .selectAll().executeTakeFirst();
    if (exists) return reply.status(409).send({ status: 0, message: "Agent already in team" });

    await (db as any).insertInto("team_members").values({
      team_id,
      owner_username: username,
      agent_username,
      created_at: new Date(),
    }).execute();

    return reply.send({ status: 1, message: "Agent added to team" });
  } catch (err: any) {
    console.error("[teams] addTeamMember:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to add member" });
  }
};

// ── Remove agent from team ────────────────────────────────────────────────────
export const removeTeamMember = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = getUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { team_id, agent_username } = req.params as { team_id: string; agent_username: string };

  try {
    await (db as any).deleteFrom("team_members")
      .where("team_id", "=", team_id)
      .where("agent_username", "=", agent_username)
      .where("owner_username", "=", username)
      .execute();

    return reply.send({ status: 1, message: "Agent removed from team" });
  } catch (err: any) {
    console.error("[teams] removeTeamMember:", err?.message);
    return reply.status(500).send({ status: 0, message: "Failed to remove member" });
  }
};
