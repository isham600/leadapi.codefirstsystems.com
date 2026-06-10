import { Worker } from "bullmq";
import { redisConnection } from "../queues/campaign.queue.js";
import type { WebhookJobData } from "../queues/webhook.queue.js";
import {
  generateConversationId,
  isDuplicate,
  saveMessage,
  upsertSummary,
} from "../utils/webhook-processor.js";
import { processChatbotMessage } from "../utils/chatbot-engine.js";

// ============================================================
// webhook-chatbot worker
// Purpose: Receive inbound messages on the "chatbot" channel,
// persist them, then drive the internal flow-based chatbot
// engine (no external URL required).
// ============================================================

// ── Extract basic message fields from any payload ─────────
function extractMessage(payload: any): {
  messageId: string | null;
  senderId:  string | null;
  text:      string | null;
  type:      string;
} {
  const msg =
    payload?.message ??
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ??
    payload;
  return {
    messageId: msg?.id        ?? msg?.messageId ?? null,
    senderId:  msg?.from      ?? msg?.sender    ?? msg?.senderId ?? null,
    text:      msg?.text?.body ?? msg?.text     ?? msg?.body    ?? null,
    type:      msg?.type      ?? "text",
  };
}

const worker = new Worker<WebhookJobData>(
  "webhook-chatbot",
  async (job) => {
    const { uuid, username, channel, payload } = job.data;

    const extracted  = extractMessage(payload);
    const messageId  = extracted.messageId ?? `chatbot_${Date.now()}`;
    const senderId   = extracted.senderId  ?? "unknown";

    // ── Dedup ────────────────────────────────────────────────
    if (await isDuplicate(messageId)) {
      console.log(`[webhook-chatbot] Duplicate skipped: ${messageId}`);
      return;
    }

    const conversationId = generateConversationId(uuid, "chatbot", uuid, senderId);
    const preview = extracted.type === "text"
      ? (extracted.text?.slice(0, 200) ?? null)
      : `[${extracted.type}]`;

    // ── Save inbound message ─────────────────────────────────
    await saveMessage({
      uuid, username,
      channel:         "chatbot",
      conversation_id: conversationId,
      message_id:      messageId,
      sender_id:       uuid,        // business account id
      receiver_id:     senderId,    // contact phone
      type:            extracted.type,
      text:            extracted.text,
      direction:       "inbound",
      status:          "received",
      raw_payload:     JSON.stringify(payload),
    });

    await upsertSummary({
      uuid, username,
      conversation_id:   conversationId,
      channel:           "chatbot",
      sender_id:         uuid,
      receiver_id:       senderId,
      last_message:      preview,
      last_message_type: extracted.type,
      last_message_dir:  "inbound",
    });

    // ── Run internal chatbot engine ──────────────────────────
    // Only process text messages through the flow engine.
    // Non-text messages are stored but do not advance the flow.
    if (extracted.type === "text") {
      await processChatbotMessage({
        uuid,
        username,
        channel,
        conversationId,
        senderId,
        text: extracted.text,
      });
    }

    console.log(`[webhook-chatbot] OK | user=${username} from=${senderId}`);
  },
  { connection: redisConnection as any, concurrency: 10 },
);

worker.on("failed", (job, err) =>
  console.error(`[webhook-chatbot] Job ${job?.id} failed:`, err.message),
);

export default worker;
