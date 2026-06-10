import { FastifyRequest, FastifyReply } from "fastify";

import { db } from "../../../models/db.js";

// ============================================================
// 📩 RECEIVE WEBHOOK CONTROLLER
// ============================================================
export const receiveWebhook = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // 🔑 UUID from URL params
    const { uuid } = req.params as { uuid: string };
    req.log.info({ uuid }, "Webhook received");

    if (!uuid) {
      req.log.warn("UUID missing in webhook URL");
      return reply.status(200).send({ received: false });
    }

    // ----------------------------------------------------------
    // 🔍 STEP 1: Check UUID exists in users table
    // ----------------------------------------------------------
    const user = await db
      .selectFrom("users")
      .select(["uuid"])
      .where("uuid", "=", uuid)
      .executeTakeFirst();

    // 📦 Full webhook payload
    const payload = req.body;

    // 🏷️ Optional event name (if provided by webhook)
    const event =
      typeof payload === "object" && payload !== null
        ? (payload as any).event ?? null
        : null;

    // ----------------------------------------------------------
    // ❌ UUID NOT FOUND → log & store as failed
    // ----------------------------------------------------------
    if (!user) {
      req.log.warn({ uuid }, "Webhook received for invalid UUID");

      await db
        .insertInto("webhook_logs")
        .values({
          uuid,
          event,
          payload: JSON.stringify(payload),
          status: "failed",
        })
        .execute();

      // ⚠️ Still return 200 (important for webhook providers)
      return reply.status(200).send({
        received: false,
        reason: "invalid_uuid",
      });
    }

    // ----------------------------------------------------------
    // ✅ UUID VALID → store webhook
    // ----------------------------------------------------------
    await db
      .insertInto("webhook_logs")
      .values({
        uuid,
        event,
        payload: JSON.stringify(payload),
        status: "received",
      })
      .execute();

    // ⚡ Always respond fast
    return reply.status(200).send({
      received: true,
    });
  } catch (error) {
    req.log.error(error, "Webhook processing error");

    // ----------------------------------------------------------
    // ❗ NEVER FAIL WEBHOOK RESPONSE
    // ----------------------------------------------------------
    return reply.status(200).send({
      received: false,
    });
  }
};
