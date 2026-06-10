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
import { runKeywordAutomations, runFirstMessageAutomations } from "../utils/automation-executor.js";

// ── Parse RCS payload ──────────────────────────────────────
function parseRcsPayload(payload: any) {
  try {
    const message = payload?.message ?? payload;

    const messageId = message?.messageId ?? message?.id ?? null;
    const senderId  = message?.senderPhoneNumber ?? message?.from ?? null;
    const agentId   = payload?.agentId ?? payload?.rbmAgentId ?? null;
    const text      = message?.text ?? message?.userText ?? null;

    // File resolution — three possible structures:
    //  1. userFile.payload         (inbound file from user)
    //  2. uploadedRbmFile          (agent-uploaded file)
    //  3. richCard media           (rich card)
    const userFilePayload = message?.userFile?.payload;
    const fileUrl =
      userFilePayload?.fileUri
      ?? message?.uploadedRbmFile?.fileUri
      ?? message?.richCard?.standaloneCard?.cardContent?.media?.contentInfo?.fileUrl
      ?? null;

    const fileMime     = userFilePayload?.mimeType     ?? message?.uploadedRbmFile?.mimeType     ?? null;
    const fileSize     = userFilePayload?.fileSizeBytes ?? message?.uploadedRbmFile?.fileSizeBytes ?? null;
    const fileName     = userFilePayload?.fileName      ?? message?.uploadedRbmFile?.fileName      ?? null;
    const thumbnailUrl = message?.userFile?.thumbnail?.fileUri ?? null;

    // Suggestion chip / postback reply
    const suggestionResponse = message?.suggestionResponse ?? null;
    const suggestionText     = suggestionResponse?.text ?? suggestionResponse?.postbackData ?? null;

    // Delivery / read receipt
    const deliveryStatus = message?.deliveryStatus ?? payload?.deliveryStatus ?? null;
    const isStatusUpdate = !!deliveryStatus && !text && !fileUrl && !suggestionText;

    // Determine message type from mime or fallback
    let type: string;
    if (isStatusUpdate) {
      type = "status";
    } else if (suggestionText) {
      type = "suggestion";
    } else if (fileUrl) {
      const mime = (fileMime ?? "").toLowerCase();
      if (mime.startsWith("video/"))      type = "video";
      else if (mime.startsWith("audio/")) type = "audio";
      else if (mime.startsWith("image/")) type = "image";
      else if (mime)                      type = "document";
      else                                type = "image";
    } else if (text) {
      type = "text";
    } else {
      type = "unknown";
    }

    const epochTimestamp    = message?.epochTimestamp    ?? payload?.epochTimestamp    ?? null;
    const communicationType = message?.communicationType ?? payload?.communicationType ?? null;
    const botId             = message?.botId             ?? payload?.botId             ?? null;
    const botName           = message?.botName           ?? payload?.botName           ?? null;

    return {
      messageId, senderId, agentId,
      text: suggestionText ?? text,
      fileUrl, fileMime, fileSize, fileName, thumbnailUrl,
      type, epochTimestamp, communicationType, botId, botName,
      deliveryStatus, isStatusUpdate,
    };
  } catch {
    return null;
  }
}

// ── Worker ─────────────────────────────────────────────────
const worker = new Worker<WebhookJobData>(
  "webhook-rcs",
  async (job) => {
    const { uuid, username, payload } = job.data;
    const forwardPayload = () => forwardToUrls(uuid, username, "rcs", payload).catch(() => {});

    const parsed = parseRcsPayload(payload);
    if (!parsed || parsed.type === "unknown") {
      forwardPayload();
      return;
    }

    // ── Delivery / read status update ────────────────────────
    if (parsed.isStatusUpdate && parsed.messageId) {
      const status = (parsed.deliveryStatus as string).toLowerCase(); // delivered / read / failed
      await (db as any)
        .updateTable("chat_messages")
        .set({ status, updated_at: new Date() })
        .where("message_id", "=", parsed.messageId)
        .where("username",   "=", username)
        .execute().catch(() => {});
      forwardPayload();
      console.log(`[webhook-rcs] Status update | ${parsed.messageId} → ${status}`);
      return;
    }

    const messageId  = parsed.messageId ?? `rcs_${Date.now()}`;
    const receiverId = (parsed.senderId ?? "unknown").replace(/^\+/, "");
    const senderId   = parsed.agentId   ?? uuid;

    if (await isDuplicate(messageId)) {
      console.log(`[webhook-rcs] Duplicate skipped: ${messageId}`);
      return;
    }

    const conversationId = generateConversationId(uuid, "rcs", senderId, receiverId);
    const preview = parsed.type === "text"
      ? (parsed.text?.slice(0, 200) ?? null)
      : `[${parsed.type}${parsed.fileName ? `: ${parsed.fileName}` : ""}]`;

    await saveMessage({
      uuid, username,
      channel:            "rcs",
      conversation_id:    conversationId,
      message_id:         messageId,
      sender_id:          senderId,
      receiver_id:        receiverId,
      type:               parsed.type,
      text:               parsed.text,
      media_url:          parsed.fileUrl  ?? null,
      media_mime:         parsed.fileMime ?? null,
      media_filename:     parsed.fileName ?? null,
      media_size_bytes:   parsed.fileSize ?? null,
      direction:          "inbound",
      status:             "received",
      platform_timestamp: parsed.epochTimestamp ?? null,
      metadata:           JSON.stringify({
        communicationType: parsed.communicationType,
        botId:             parsed.botId,
        botName:           parsed.botName,
        thumbnailUrl:      parsed.thumbnailUrl,
      }),
      raw_payload:        JSON.stringify(payload),
    });

    await upsertSummary({
      uuid, username,
      conversation_id:   conversationId,
      channel:           "rcs",
      sender_id:         senderId,
      receiver_id:       receiverId,
      last_message:      preview,
      last_message_type: parsed.type,
      last_message_dir:  "inbound",
    });

    forwardPayload();

    // ── First message detection ────────────────────────────────────────────────
    const priorCount: any = await (db as any)
      .selectFrom("chat_messages")
      .select((eb: any) => eb.fn.count("id").as("cnt"))
      .where("uuid",            "=", uuid)
      .where("conversation_id", "=", conversationId)
      .where("direction",       "=", "inbound")
      .executeTakeFirst();

    if (Number(priorCount?.cnt ?? 0) <= 1) {
      runFirstMessageAutomations({ uuid, username, phone: receiverId, channel: "rcs" }).catch(() => {});
    }

    // ── Chatbot engine: run if user has active flows and message is text ──────
    if (parsed.type === "text" && parsed.text) {
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
          channel:       "rcs",
          conversationId,
          senderId: receiverId,
          text:     parsed.text,
        }).catch((err: any) =>
          console.error(`[webhook-rcs] chatbot engine error:`, err?.message),
        );
      }
    }

    // ── Automation executor: keyword triggers ─────────────────────────────────
    if (parsed.type === "text" && parsed.text) {
      runKeywordAutomations({ uuid, username, text: parsed.text, phone: receiverId }).catch(() => {});
    }

    console.log(`[webhook-rcs] OK | user=${username} from=${receiverId} type=${parsed.type}`);
  },
  { connection: redisConnection as any, concurrency: 10 },
);

worker.on("failed", (job, err) =>
  console.error(`[webhook-rcs] Job ${job?.id} failed:`, err.message),
);

export default worker;
