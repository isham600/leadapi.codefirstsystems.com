import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
 
 
 
/**
 * ============================================================
 * 📘 FACEBOOK WEBHOOK CONTROLLER (ENTERPRISE GRADE)
 * ============================================================
 * - Supports Meta verification (GET)
 * - Validates UUID (multi-tenant safe)
 * - Stores raw webhook payload
 * - Stores failure reasons
 * - Never breaks Facebook retries
 * ============================================================
 */

 
 

/**
 * ============================================================
 * 📘 FACEBOOK WEBHOOK CONTROLLER (ENTERPRISE GRADE)
 * ============================================================
 */

export const receiveWebhookFacebook = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  /* ============================================================
     🔹 STEP 1: FACEBOOK VERIFICATION (GET)
  ============================================================ */
  if (req.method === "GET") {
    const query = req.query as Record<string, string>;

    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];
    const uuid = query["uuid"] || query["id"];

    // Fetch secret_key from webhook table
    if (!uuid) {
      return reply.status(403).send("UUID required for verification");
    }

    const webhook = await db
      .selectFrom("webhook")
      .select(["secret_key"])
      .where("uuid", "=", uuid)
      .where("status", "=", 1)
      .executeTakeFirst();

    if (!webhook || !webhook.secret_key) {
      return reply.status(403).send("Verification failed");
    }

    if (mode === "subscribe" && token === webhook.secret_key) {
      return reply.status(200).send(challenge);
    }

    return reply.status(403).send("Verification failed");
  }

  /* ============================================================
     🔹 STEP 2: FACEBOOK WEBHOOK PAYLOAD (POST)
  ============================================================ */
  let responseCode = "200"; // ✅ NEW (default)

  try {
    const { uuid } = req.params as { uuid?: string };
    const payload = req.body;
    const leadgenId = extractLeadgenId(payload);

    req.log.info({ uuid, leadgenId }, "Facebook webhook received");

    // ❌ UUID missing
    if (!uuid) {
      responseCode = "400";

      await storeWebhookLog({
        uuid: null,
        username: null,
        url: null,
        payload,
        leadgenId,
        response_code: responseCode,
        platform: "FACEBOOK",
        status: "failed",
        reason: "uuid_missing",
      });

      return reply.status(200).send({ received: false });
    }

    // 🔍 Fetch webhook details from webhook table
    const webhook = await db
      .selectFrom("webhook")
      .select(["username", "url", "secret_key"])
      .where("uuid", "=", uuid)
      .where("status", "=", 1)
      .executeTakeFirst();

    // ❌ Invalid UUID
    if (!webhook) {
      responseCode = "404";

      await storeWebhookLog({
        uuid,
        username: null,
        url: null,
        payload,
        leadgenId,
        response_code: responseCode,
        platform: "FACEBOOK",
        status: "failed",
        reason: "invalid_uuid",
      });

      return reply.status(200).send({
        received: false,
        reason: "invalid_uuid",
      });
    }

    const { username, url } = webhook;

    // ❌ leadgen_id missing
    if (!leadgenId) {
      responseCode = "422";

      await storeWebhookLog({
        uuid,
        username,
        url,
        payload,
        leadgenId: null,
        response_code: responseCode,
        platform: "FACEBOOK",
        status: "failed",
        reason: "leadgen_id_missing",
      });

      return reply.status(200).send({
        received: false,
        reason: "leadgen_id_missing",
      });
    }

    // ✅ Valid webhook
    await storeWebhookLog({
      uuid,
      username,
      url,
      payload,
      leadgenId,
      response_code: responseCode,
      platform: "FACEBOOK",
      status: "received",
      reason: null,
    });

    return reply.status(200).send({ received: true });
  } catch (error) {
    responseCode = "500";
    req.log.error(error, "Facebook webhook processing error");

    return reply.status(200).send({ received: false });
  }
};


/* ============================================================
   🔧 HELPERS
============================================================ */

function extractLeadgenId(payload: any): string | null {
  try {
    return payload?.entry?.[0]?.changes?.[0]?.value?.leadgen_id ?? null;
  } catch {
    return null;
  }
}

 


async function storeWebhookLog({
  uuid,
  username,
  url,
  payload,
  leadgenId,
  response_code,
  platform,
  status,
  reason,
}: {
  uuid: string | null;
  username: string | null;
  url: string | null;
  payload: unknown;
  leadgenId: string | null;
  response_code: string;
  platform: string;
  status: "received" | "failed" | "processed";
  reason: string | null;
}) {
  await db.insertInto("webhook_logs").values({
    uuid,
    username,
    url,
    event: "facebook_lead",
    leadgen_id: leadgenId,
    payload: JSON.stringify(payload),
    response_code,
    platform,
    status,
    reason,
    created_at: new Date(),
  }).execute();
}
