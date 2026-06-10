import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

// ============================================================
// GET /api/webhook/auth/rcs/accounts
// ============================================================
export const listRcsAccounts = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const accounts = await (db as any)
    .selectFrom("rcs_accounts")
    .select(["id", "agent_id", "bot_id", "bot_name", "status", "created_at", "updated_at"])
    .where("username", "=", username)
    .orderBy("created_at", "desc")
    .execute();

  return reply.send({ status: 1, data: accounts });
};

// ============================================================
// POST /api/webhook/auth/rcs/accounts
// Body: { agent_id, bot_id?, bot_name?, api_key }
// ============================================================
export const createRcsAccount = async (
  req: FastifyRequest<{ Body: { agent_id: string; bot_id?: string; bot_name?: string; api_key: string } }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { agent_id, bot_id, bot_name, api_key } = req.body ?? {};
  if (!agent_id?.trim()) return reply.status(400).send({ status: 0, message: "agent_id is required" });
  if (!api_key?.trim())  return reply.status(400).send({ status: 0, message: "api_key is required" });

  const now = new Date();
  await (db as any)
    .insertInto("rcs_accounts")
    .values({
      username,
      agent_id:  agent_id.trim(),
      bot_id:    bot_id?.trim()   ?? null,
      bot_name:  bot_name?.trim() ?? null,
      api_key:   api_key.trim(),
      status:    "active",
      created_at: now,
      updated_at: now,
    })
    .execute();

  return reply.status(201).send({ status: 1, message: "RCS account created" });
};

// ============================================================
// PUT /api/webhook/auth/rcs/accounts/:id
// Body: { agent_id?, bot_id?, bot_name?, api_key?, status? }
// ============================================================
export const updateRcsAccount = async (
  req: FastifyRequest<{
    Params: { id: string };
    Body: { agent_id?: string; bot_id?: string; bot_name?: string; api_key?: string; status?: string };
  }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const id = parseInt(req.params.id);
  const { agent_id, bot_id, bot_name, api_key, status } = req.body ?? {};

  const update: Record<string, any> = { updated_at: new Date() };
  if (agent_id !== undefined) update.agent_id = agent_id.trim();
  if (bot_id   !== undefined) update.bot_id   = bot_id?.trim()   ?? null;
  if (bot_name !== undefined) update.bot_name = bot_name?.trim() ?? null;
  if (api_key  !== undefined) update.api_key  = api_key.trim();
  if (status   !== undefined) update.status   = status;

  await (db as any)
    .updateTable("rcs_accounts")
    .set(update)
    .where("id",       "=", id)
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "RCS account updated" });
};

// ============================================================
// DELETE /api/webhook/auth/rcs/accounts/:id
// ============================================================
export const deleteRcsAccount = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const id = parseInt(req.params.id);
  await (db as any)
    .deleteFrom("rcs_accounts")
    .where("id",       "=", id)
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "RCS account deleted" });
};
