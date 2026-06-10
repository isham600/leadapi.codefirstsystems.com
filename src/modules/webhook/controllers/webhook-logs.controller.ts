import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

// ============================================================
// GET /api/webhook/auth/logs
// Returns paginated webhook logs for the logged-in user
// ============================================================
export const getWebhookLogs = async (
  req: FastifyRequest<{
    Querystring: {
      page?:    string;
      limit?:   string;
      channel?: string;
    };
  }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  const page    = Math.max(1, parseInt(req.query.page  || "1"));
  const limit   = Math.min(100, Math.max(1, parseInt(req.query.limit || "20")));
  const channel = req.query.channel?.trim();
  const offset  = (page - 1) * limit;

  try {
    let query = (db as any)
      .selectFrom("webhook_inbound_logs")
      .select(["id", "uuid", "channel", "payload", "ip_address", "status", "created_at"])
      .where("username", "=", username)
      .orderBy("created_at", "desc");

    let countQuery = (db as any)
      .selectFrom("webhook_inbound_logs")
      .select((eb: any) => eb.fn.count("id").as("count"))
      .where("username", "=", username);

    if (channel && channel !== "all") {
      query      = query.where("channel", "=", channel);
      countQuery = countQuery.where("channel", "=", channel);
    }

    const [logs, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).execute(),
      countQuery.executeTakeFirst(),
    ]);

    const total      = Number(totalResult?.count ?? 0);
    const totalPages = Math.ceil(total / limit);

    return reply.send({
      status:     1,
      statuscode: 200,
      message:    "Webhook logs fetched successfully",
      data:       logs,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
        has_next:    page < totalPages,
        has_prev:    page > 1,
      },
    });
  } catch (error: any) {
    console.error("[webhook] getWebhookLogs error:", error?.message);
    return reply.status(500).send({
      status:     0,
      statuscode: 500,
      message:    "Failed to fetch webhook logs",
      data:       null,
    });
  }
};

// ============================================================
// GET /api/webhook/auth/settings
// Returns per-channel token verification settings for the logged-in user
// ============================================================
const VALID_CHANNELS = ["whatsapp", "facebook", "google", "rcs"] as const;

export const getWebhookSettings = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  try {
    const user: any = await (db as any)
      .selectFrom("users")
      .select(["uuid"])
      .where("username", "=", username)
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({ status: 0, statuscode: 404, message: "User not found", data: null });
    }

    // Fetch per-channel settings rows
    const rows: any[] = await (db as any)
      .selectFrom("webhook_channel_settings")
      .select(["channel", "verify_token_enabled", "verify_token"])
      .where("username", "=", username)
      .execute();

    // Build a map keyed by channel
    const channelMap: Record<string, { verify_token_enabled: boolean; verify_token: string | null }> = {};
    for (const row of rows) {
      channelMap[row.channel] = {
        verify_token_enabled: row.verify_token_enabled === 1,
        verify_token:         row.verify_token ?? null,
      };
    }

    // Return one entry per valid channel (default: disabled, no token)
    const channels = VALID_CHANNELS.map((ch) => ({
      channel:               ch,
      verify_token_enabled:  channelMap[ch]?.verify_token_enabled ?? false,
      verify_token:          channelMap[ch]?.verify_token ?? null,
      webhook_url:           `POST /api/webhook/${user.uuid}/${ch}`,
    }));

    return reply.send({
      status:     1,
      statuscode: 200,
      message:    "Webhook settings fetched",
      data: {
        uuid:            user.uuid,
        webhook_url:     `POST /api/webhook/${user.uuid}/{channel}`,
        valid_channels:  VALID_CHANNELS,
        channels,
      },
    });
  } catch (error: any) {
    console.error("[webhook] getWebhookSettings error:", error?.message);
    return reply.status(500).send({ status: 0, statuscode: 500, message: "Failed to fetch settings", data: null });
  }
};

// ============================================================
// PUT /api/webhook/auth/settings
// Update per-channel token verification settings
// Body: { channel: string, verify_token_enabled: boolean, verify_token?: string }
// ============================================================
export const updateWebhookSettings = async (
  req: FastifyRequest<{
    Body: {
      channel:               string;
      verify_token_enabled?: boolean;
      verify_token?:         string;
    };
  }>,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  const { channel, verify_token_enabled, verify_token } = req.body ?? {};

  if (!channel || !VALID_CHANNELS.includes(channel as any)) {
    return reply.status(400).send({
      status: 0, statuscode: 400,
      message: `channel must be one of: ${VALID_CHANNELS.join(", ")}`,
      data: null,
    });
  }

  if (verify_token_enabled === true && typeof verify_token === "string" && verify_token.trim().length === 0) {
    return reply.status(400).send({
      status: 0, statuscode: 400,
      message: "verify_token cannot be empty",
      data: null,
    });
  }

  try {
    // Get user UUID for the row
    const user: any = await (db as any)
      .selectFrom("users")
      .select(["uuid"])
      .where("username", "=", username)
      .executeTakeFirst();

    if (!user) {
      return reply.status(404).send({ status: 0, statuscode: 404, message: "User not found", data: null });
    }

    const enabled = typeof verify_token_enabled === "boolean" ? (verify_token_enabled ? 1 : 0) : undefined;
    const token   = typeof verify_token === "string" && verify_token.trim().length > 0 ? verify_token.trim() : undefined;

    // Upsert into webhook_channel_settings
    const existing: any = await (db as any)
      .selectFrom("webhook_channel_settings")
      .select(["id"])
      .where("username", "=", username)
      .where("channel",  "=", channel)
      .executeTakeFirst();

    if (existing) {
      const updates: Record<string, any> = { updated_at: new Date() };
      if (enabled !== undefined) updates.verify_token_enabled = enabled;
      if (token   !== undefined) updates.verify_token         = token;

      await (db as any)
        .updateTable("webhook_channel_settings")
        .set(updates)
        .where("username", "=", username)
        .where("channel",  "=", channel)
        .execute();
    } else {
      await (db as any)
        .insertInto("webhook_channel_settings")
        .values({
          username,
          uuid:                 user.uuid,
          channel,
          verify_token_enabled: enabled ?? 0,
          verify_token:         token ?? null,
          created_at:           new Date(),
          updated_at:           new Date(),
        })
        .execute();
    }

    return reply.send({
      status:     1,
      statuscode: 200,
      message:    "Webhook channel settings updated",
      data:       null,
    });
  } catch (error: any) {
    console.error("[webhook] updateWebhookSettings error:", error?.message);
    return reply.status(500).send({ status: 0, statuscode: 500, message: "Failed to update settings", data: null });
  }
};
