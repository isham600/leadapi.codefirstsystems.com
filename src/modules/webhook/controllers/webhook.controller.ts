import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { dispatchWhatsapp } from "../channels/whatsapp.channel.js";
import { dispatchFacebook } from "../channels/facebook.channel.js";
import { dispatchGoogle }   from "../channels/google.channel.js";
import { dispatchRcs }      from "../channels/rcs.channel.js";
import { dispatchGeneric }  from "../channels/generic.channel.js";
import { dispatchChatbot }  from "../channels/chatbot.channel.js";
import type { WebhookJobData } from "../../../queues/webhook.queue.js";

const VALID_CHANNELS = ["whatsapp", "facebook", "google", "rcs", "webhook", "chatbot"] as const;

// ============================================================
// GET /api/webhook/:uuid/:channel
// Hub challenge verification (WhatsApp & Facebook)
// ============================================================
export const verifyWebhook = async (
  req: FastifyRequest<{ Params: { uuid: string; channel: string }; Querystring: Record<string, string> }>,
  reply: FastifyReply,
) => {
  const { uuid } = req.params;
  const query    = req.query as Record<string, string>;

  const mode      = query["hub.mode"];
  const token     = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (mode !== "subscribe" || !token || !challenge) {
    return reply.status(400).send("Bad verification request");
  }

  // Look up per-channel settings first
  const channelSetting: any = await (db as any)
    .selectFrom("webhook_channel_settings")
    .select(["verify_token_enabled", "verify_token"])
    .where("uuid",    "=", uuid)
    .where("channel", "=", req.params.channel)
    .executeTakeFirst();

  // No row or token verification disabled → auto-accept (Meta can use any verify token)
  if (!channelSetting || channelSetting.verify_token_enabled !== 1) {
    return reply.status(200).send(challenge);
  }

  // Token verification enabled but no token saved yet → auto-approve
  if (!channelSetting.verify_token) {
    return reply.status(200).send(challenge);
  }

  // Must match stored token
  if (token !== channelSetting.verify_token) {
    return reply.status(403).send("Verification failed");
  }

  return reply.status(200).send(challenge);
};
type Channel = typeof VALID_CHANNELS[number];

// ── Channel dispatcher map ────────────────────────────────
const channelDispatcher: Record<Channel, (data: WebhookJobData) => Promise<void>> = {
  whatsapp: dispatchWhatsapp,
  facebook: dispatchFacebook,
  google:   dispatchGoogle,
  rcs:      dispatchRcs,
  webhook:  dispatchGeneric,
  chatbot:  dispatchChatbot,
};

// ============================================================
// POST /api/webhook/:uuid/:channel
// ============================================================
export const receiveWebhook = async (
  req: FastifyRequest<{ Params: { uuid: string; channel: string } }>,
  reply: FastifyReply,
) => {
  const { uuid, channel } = req.params;

  // ── Validate channel ──────────────────────────────────────
  if (!VALID_CHANNELS.includes(channel as Channel)) {
    return reply.status(400).send({
      status: 0,
      statuscode: 400,
      message: `Unknown channel '${channel}'. Valid: ${VALID_CHANNELS.join(", ")}`,
      data: null,
    });
  }

  const { username } = req.webhookUser!;
  const payload      = req.body ?? {};
  const ip_address   = req.ip ?? null;

  // Safe headers subset (avoid huge header dumps)
  const safeHeaders: Record<string, string> = {};
  for (const key of ["content-type", "user-agent", "x-forwarded-for", "x-real-ip"]) {
    if (req.headers[key]) safeHeaders[key] = req.headers[key] as string;
  }

  const jobData: WebhookJobData = {
    uuid,
    username,
    channel,
    payload,
    headers:    safeHeaders,
    ip_address,
  };

  // ── Fire & forget: log to DB ──────────────────────────────
  (db as any)
    .insertInto("webhook_inbound_logs")
    .values({
      uuid,
      username,
      channel,
      payload:    JSON.stringify(payload),
      headers:    JSON.stringify(safeHeaders),
      ip_address,
      status:     "received",
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute()
    .catch((err: any) =>
      console.error("[webhook] log insert failed:", err?.message),
    );

  // ── Fire & forget: dispatch to channel queue ──────────────
  channelDispatcher[channel as Channel](jobData).catch((err: any) =>
    console.error(`[webhook] dispatch to ${channel} queue failed:`, err?.message),
  );

  // ── Instant 200 reply ─────────────────────────────────────
  return reply.status(200).send({ status: 1, message: "OK" });
};
