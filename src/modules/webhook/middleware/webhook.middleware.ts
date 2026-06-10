import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

// Augment FastifyRequest to carry resolved webhook context
declare module "fastify" {
  interface FastifyRequest {
    webhookUser?: {
      uuid:     string;
      username: string;
    };
  }
}

// Meta channels use x-hub-signature-256 for payload signing — never send x-webhook-secret
const META_CHANNELS = new Set(["whatsapp", "facebook", "google"]);

/**
 * Resolves the user from the UUID param.
 * For generic channels: validates x-webhook-secret header if webhook_secret_enabled = 1.
 * For Meta channels (whatsapp/facebook/google): skips secret check — Meta uses
 * x-hub-signature-256 payload signing instead of a custom header.
 */
export const webhookMiddleware = async (
  req: FastifyRequest<{ Params: { uuid: string; channel: string } }>,
  reply: FastifyReply,
) => {
  const { uuid, channel } = req.params;

  // ── 1. Resolve user by UUID ──────────────────────────────
  const user: any = await (db as any)
    .selectFrom("users")
    .select(["uuid", "username", "webhook_secret", "webhook_secret_enabled"])
    .where("uuid", "=", uuid)
    .executeTakeFirst();

  if (!user) {
    return reply.status(404).send({
      status: 0,
      statuscode: 404,
      message: "Webhook endpoint not found",
      data: null,
    });
  }

  // ── 2. Secret key check — skip for Meta channels ─────────
  // Meta (facebook/whatsapp/google) signs payloads with x-hub-signature-256.
  // x-webhook-secret is only for generic/custom integrations.
  if (!META_CHANNELS.has(channel) && user.webhook_secret_enabled === 1) {
    const incomingSecret = req.headers["x-webhook-secret"] as string | undefined;

    if (!incomingSecret || incomingSecret !== user.webhook_secret) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Invalid or missing webhook secret",
        data: null,
      });
    }
  }

  // ── 3. Attach to request for downstream use ───────────────
  req.webhookUser = {
    uuid:     user.uuid,
    username: user.username,
  };
};
