import { Worker } from "bullmq";
import { redisConnection } from "../queues/campaign.queue.js";
import { db } from "../models/db.js";
import type { WebhookJobData } from "../queues/webhook.queue.js";
import {
  generateConversationId,
  isDuplicate,
  saveMessage,
  upsertSummary,
  forwardToUrls,
} from "../utils/webhook-processor.js";
import { processChatbotMessage } from "../utils/chatbot-engine.js";
import {
  runKeywordAutomations,
  runButtonReplyAutomations,
  runFirstMessageAutomations,
} from "../utils/automation-executor.js";

// ── Parse Facebook / Instagram payload ───────────────────────
function parseFacebookPayload(payload: any): {
  entryId:    string | null;
  pageId:     string | null;
  leadgenId:  string | null;
  adId:       string | null;
  formId:     string | null;
  senderId:   string | null;
  text:       string | null;
  messageId:  string | null;
  eventType:  string;
} {
  try {
    const entry     = payload?.entry?.[0];
    const change    = entry?.changes?.[0]?.value;
    const messaging = entry?.messaging?.[0];

    // ── Lead-gen / leadgen_update ─────────────────────────
    if (change?.leadgen_id) {
      return {
        entryId:   entry?.id          ?? null,
        pageId:    change?.page_id    ?? null,
        leadgenId: String(change.leadgen_id),
        adId:      change?.ad_id      ?? null,
        formId:    change?.form_id    ?? null,
        senderId:  null,
        text:      null,
        messageId: `fb_lead_${change.leadgen_id}`,
        eventType: "lead",
      };
    }

    // ── Messenger / Instagram postback (button tap) ───────
    if (messaging?.postback) {
      const pb = messaging.postback;
      return {
        entryId:   entry?.id               ?? null,
        pageId:    entry?.id               ?? null,
        leadgenId: null,
        adId:      null,
        formId:    null,
        senderId:  messaging?.sender?.id   ?? null,
        text:      pb.title ?? pb.payload  ?? "[postback]",
        messageId: pb.mid ?? `fb_pb_${Date.now()}`,
        eventType: "postback",
      };
    }

    // ── Referral (ad click / m.me link) ──────────────────
    if (messaging?.referral) {
      const ref = messaging.referral;
      return {
        entryId:   entry?.id             ?? null,
        pageId:    entry?.id             ?? null,
        leadgenId: null,
        adId:      ref?.ad_id            ?? null,
        formId:    null,
        senderId:  messaging?.sender?.id ?? null,
        text:      `[referral] source:${ref?.source ?? "?"} ref:${ref?.ref ?? ""}`,
        messageId: `fb_ref_${messaging?.sender?.id ?? Date.now()}`,
        eventType: "referral",
      };
    }

    // ── Messenger / Instagram message ─────────────────────
    if (messaging?.message) {
      return {
        entryId:   entry?.id               ?? null,
        pageId:    entry?.id               ?? null,
        leadgenId: null,
        adId:      null,
        formId:    null,
        senderId:  messaging?.sender?.id   ?? null,
        text:      messaging?.message?.text ?? null,
        messageId: messaging?.message?.mid  ?? null,
        eventType: "message",
      };
    }

    return {
      entryId: null, pageId: null, leadgenId: null,
      adId: null, formId: null, senderId: null,
      text: null, messageId: null, eventType: "unknown",
    };
  } catch {
    return {
      entryId: null, pageId: null, leadgenId: null,
      adId: null, formId: null, senderId: null,
      text: null, messageId: null, eventType: "unknown",
    };
  }
}

// ── Worker ─────────────────────────────────────────────────
const worker = new Worker<WebhookJobData>(
  "webhook-facebook",
  async (job) => {
    const { uuid, username, payload } = job.data;

    const parsed = parseFacebookPayload(payload);
    if (parsed.eventType === "unknown") return;

    const messageId  = parsed.messageId ?? `fb_${Date.now()}`;
    const receiverId = parsed.senderId ?? parsed.leadgenId ?? "unknown";
    const senderId   = parsed.pageId   ?? uuid;

    // ── Dedup ────────────────────────────────────────────────
    if (await isDuplicate(messageId)) {
      console.log(`[webhook-facebook] Duplicate skipped: ${messageId}`);
      return;
    }

    const conversationId = generateConversationId(uuid, "facebook", senderId, receiverId);

    const metadata = JSON.stringify({
      leadgen_id: parsed.leadgenId,
      ad_id:      parsed.adId,
      form_id:    parsed.formId,
      event_type: parsed.eventType,
    });

    const preview = parsed.eventType === "lead"
      ? `[lead] leadgen_id:${parsed.leadgenId}`
      : parsed.eventType === "postback"
        ? `[postback] ${parsed.text?.slice(0, 200) ?? ""}`
        : parsed.eventType === "referral"
          ? parsed.text?.slice(0, 200) ?? "[referral]"
          : (parsed.text?.slice(0, 200) ?? "[message]");

    const msgType = parsed.eventType === "lead"     ? "lead"
                  : parsed.eventType === "postback"  ? "postback"
                  : parsed.eventType === "referral"  ? "referral"
                  : "text";

    // ── Save message ─────────────────────────────────────────
    await saveMessage({
      uuid, username,
      channel:         "facebook",
      conversation_id: conversationId,
      message_id:      messageId,
      sender_id:       senderId,
      receiver_id:     receiverId,
      type:            msgType,
      text:            parsed.text,
      direction:       "inbound",
      status:          "received",
      metadata,
      raw_payload:     JSON.stringify(payload),
    });

    // ── Upsert sidebar summary ───────────────────────────────
    await upsertSummary({
      uuid, username,
      conversation_id:   conversationId,
      channel:           "facebook",
      sender_id:         senderId,
      receiver_id:       receiverId,
      last_message:      preview,
      last_message_type: msgType,
      last_message_dir:  "inbound",
    });

    // ── Forward to URLs (fire & forget) ─────────────────────
    forwardToUrls(uuid, username, "facebook", payload).catch(() => {});

    // ── First message detection ────────────────────────────────────────────────
    if (parsed.eventType === "message" || parsed.eventType === "postback") {
      const priorCount: any = await (db as any)
        .selectFrom("chat_messages")
        .select((eb: any) => eb.fn.count("id").as("cnt"))
        .where("uuid",            "=", uuid)
        .where("conversation_id", "=", conversationId)
        .where("direction",       "=", "inbound")
        .executeTakeFirst();

      if (Number(priorCount?.cnt ?? 0) <= 1) {
        runFirstMessageAutomations({ uuid, username, phone: receiverId ?? "", channel: "facebook" }).catch(() => {});
      }
    }

    // ── Chatbot engine: only for Messenger text messages (not lead-gen) ───────
    if (parsed.eventType === "message" && parsed.text) {
      const hasActiveFlow: any = await (db as any)
        .selectFrom("chatbot_flows")
        .select(["id"])
        .where("uuid",      "=", uuid)
        .where("is_active", "=", 1)
        .executeTakeFirst();

      if (hasActiveFlow) {
        processChatbotMessage({
          uuid,
          username,
          channel:       "facebook",
          conversationId,
          senderId: receiverId,   // receiverId = contact's PSID
          text:     parsed.text,
        }).catch((err: any) =>
          console.error(`[webhook-facebook] chatbot engine error:`, err?.message),
        );
      }
    }

    // ── Automation executor: keyword + button_reply triggers ─────────────────
    if (parsed.eventType === "message" && parsed.text) {
      runKeywordAutomations({ uuid, username, text: parsed.text, phone: receiverId ?? "" }).catch(() => {});
    }

    if (parsed.eventType === "postback" && parsed.text) {
      runButtonReplyAutomations({
        uuid, username,
        buttonId:   parsed.text,
        buttonText: parsed.text,
        phone:      receiverId ?? "",
      }).catch(() => {});
    }

    console.log(`[webhook-facebook] OK | user=${username} type=${parsed.eventType} id=${messageId}`);
  },
  { connection: redisConnection as any, concurrency: 10 },
);

worker.on("failed", (job, err) =>
  console.error(`[webhook-facebook] Job ${job?.id} failed:`, err.message),
);

export default worker;
