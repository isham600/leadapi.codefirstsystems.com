import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

const VALID_CHANNELS = ["whatsapp", "facebook", "google", "rcs", "all"];

// ============================================================
// GET /api/webhook/auth/forward-urls
// ============================================================
export const listForwardUrls = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const rows = await (db as any)
    .selectFrom("webhook_forward_urls")
    .selectAll()
    .where("username", "=", username)
    .orderBy("created_at", "desc")
    .execute();

  return reply.send({ status: 1, statuscode: 200, message: "Forward URLs fetched", data: rows });
};

// ============================================================
// POST /api/webhook/auth/forward-urls
// Body: { url, channel }
// ============================================================
export const addForwardUrl = async (
  req: FastifyRequest<{ Body: { url: string; channel?: string } }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  const uuid     = req.user?.uuid;
  if (!username || !uuid) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { url, channel = "all" } = req.body ?? {};

  if (!url?.trim())                        return reply.status(400).send({ status: 0, message: "url is required" });
  if (!VALID_CHANNELS.includes(channel))   return reply.status(400).send({ status: 0, message: `channel must be one of: ${VALID_CHANNELS.join(", ")}` });

  try {
    new URL(url); // validate URL format
  } catch {
    return reply.status(400).send({ status: 0, message: "Invalid URL format" });
  }

  const now = new Date();
  await (db as any)
    .insertInto("webhook_forward_urls")
    .values({ uuid, username, url: url.trim(), channel, status: "active", created_at: now, updated_at: now })
    .execute();

  return reply.status(201).send({ status: 1, statuscode: 201, message: "Forward URL added" });
};

// ============================================================
// PUT /api/webhook/auth/forward-urls/:id
// Body: { url?, channel?, status? }
// ============================================================
export const updateForwardUrl = async (
  req: FastifyRequest<{
    Params: { id: string };
    Body:   { url?: string; channel?: string; status?: string };
  }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  const id       = Number(req.params.id);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const updates: Record<string, any> = { updated_at: new Date() };
  const { url, channel, status } = req.body ?? {};

  if (url?.trim()) {
    try { new URL(url); } catch { return reply.status(400).send({ status: 0, message: "Invalid URL format" }); }
    updates.url = url.trim();
  }
  if (channel) {
    if (!VALID_CHANNELS.includes(channel)) return reply.status(400).send({ status: 0, message: "Invalid channel" });
    updates.channel = channel;
  }
  if (status) {
    if (!["active", "inactive"].includes(status)) return reply.status(400).send({ status: 0, message: "status must be active or inactive" });
    updates.status = status;
  }

  await (db as any)
    .updateTable("webhook_forward_urls")
    .set(updates)
    .where("id",       "=", id)
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "Forward URL updated" });
};

// ============================================================
// DELETE /api/webhook/auth/forward-urls/:id
// ============================================================
export const deleteForwardUrl = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  const id       = Number(req.params.id);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .deleteFrom("webhook_forward_urls")
    .where("id",       "=", id)
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "Forward URL deleted" });
};
