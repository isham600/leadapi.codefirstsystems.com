import { Worker } from "bullmq";
import { redisConnection } from "../queues/campaign.queue.js";
import { db } from "../models/db.js";
import type { WebhookJobData } from "../queues/webhook.queue.js";
import {
  generateConversationId,
  normalizePhone,
  isDuplicate,
  isBlacklisted,
  addToBlacklist,
  isStopWord,
  saveMessage,
  upsertSummary,
  forwardToUrls,
} from "../utils/webhook-processor.js";
import { downloadWhatsAppMedia } from "../utils/whatsapp-media-downloader.js";
import { notify } from "../utils/notify.js";
import { processChatbotMessage } from "../utils/chatbot-engine.js";
import {
  runKeywordAutomations,
  runButtonReplyAutomations,
  runFirstMessageAutomations,
  runOptOutAutomations,
} from "../utils/automation-executor.js";

// Message types that carry a WhatsApp media_id and need downloading
const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

// ── Parse WhatsApp entry payload ───────────────────────────
function parseWhatsAppPayload(payload: any) {
  try {
    const change  = payload?.entry?.[0]?.changes?.[0]?.value;
    const meta    = change?.metadata;
    const contact = change?.contacts?.[0];
    const message = change?.messages?.[0]  ?? null;
    const status  = change?.statuses?.[0]  ?? null;
    return {
      phoneNumberId: meta?.phone_number_id       ?? null,
      displayNumber: meta?.display_phone_number  ?? null,
      contactName:   contact?.profile?.name      ?? null,
      message,
      status,
    };
  } catch { return null; }
}

function extractContent(message: any) {
  const type = message?.type ?? "unknown";
  let text: string | null = null;
  let mediaId: string | null = null;
  let mediaMime: string | null = null;
  let mediaFilename: string | null = null;
  let reactionEmoji: string | null = null;
  let locationLat: number | null = null;
  let locationLng: number | null = null;
  let locationName: string | null = null;
  let contextMessageId: string | null = message?.context?.id ?? null;
  let templateName: string | null = null;

  switch (type) {
    case "text":
      text = message?.text?.body ?? null; break;
    case "image":
      mediaId = message?.image?.id ?? null;
      mediaMime = message?.image?.mime_type ?? "image/jpeg";
      text = message?.image?.caption ?? null; break;
    case "video":
      mediaId = message?.video?.id ?? null;
      mediaMime = message?.video?.mime_type ?? "video/mp4";
      text = message?.video?.caption ?? null; break;
    case "audio":
      mediaId = message?.audio?.id ?? null;
      mediaMime = message?.audio?.mime_type ?? "audio/ogg"; break;
    case "document":
      mediaId = message?.document?.id ?? null;
      mediaMime = message?.document?.mime_type ?? null;
      mediaFilename = message?.document?.filename ?? null;
      text = message?.document?.caption ?? null; break;
    case "sticker":
      mediaId = message?.sticker?.id ?? null;
      mediaMime = "image/webp"; break;
    case "reaction":
      reactionEmoji = message?.reaction?.emoji ?? null;
      contextMessageId = message?.reaction?.message_id ?? contextMessageId; break;
    case "location":
      locationLat = message?.location?.latitude  ?? null;
      locationLng = message?.location?.longitude ?? null;
      locationName = message?.location?.name     ?? null; break;
    case "template":
      templateName = message?.template?.name ?? null; break;
    case "contacts": {
      const shared = (message?.contacts ?? []) as any[];
      text = shared
        .map((c: any) => {
          const name = c?.name?.formatted_name ?? c?.name?.first_name ?? "Unknown";
          const phones = (c?.phones ?? []).map((p: any) => p.phone).join(", ");
          return phones ? `${name} (${phones})` : name;
        })
        .join("; ");
      break;
    }
    case "interactive": {
      const nfm = message?.interactive?.nfm_reply;
      if (nfm) {
        // WhatsApp Flow response — parse the JSON answers into readable text
        try {
          const parsed = JSON.parse(nfm.response_json ?? "{}");
          const answers = Object.entries(parsed)
            .filter(([k]) => !["flow_token"].includes(k))
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          text = answers || nfm.body || "Flow response";
        } catch {
          text = nfm.body ?? "Flow response";
        }
      } else {
        text = message?.interactive?.button_reply?.title
            ?? message?.interactive?.list_reply?.title ?? null;
      }
      break;
    }
  }

  return { type, text, mediaId, mediaMime, mediaFilename, reactionEmoji,
           locationLat, locationLng, locationName, contextMessageId, templateName };
}

// ── Worker ─────────────────────────────────────────────────
const worker = new Worker<WebhookJobData>(
  "webhook-whatsapp",
  async (job) => {
    const { uuid, username, payload } = job.data;

    const parsed = parseWhatsAppPayload(payload);
    if (!parsed) return;

    const { phoneNumberId, displayNumber, contactName, message, status } = parsed;

    // ── Status update (sent / delivered / read / failed) ────
    if (status && !message) {
      const { id: wamid, status: deliveryStatus, timestamp: statusTs } = status;
      console.log(`[webhook-whatsapp] Status update | ${wamid} → ${deliveryStatus}`);

      // Derive date/time strings from the webhook timestamp (or now)
      const tsDate  = statusTs ? new Date(Number(statusTs) * 1000) : new Date();
      const dateStr = tsDate.toISOString().slice(0, 10);                    // "2026-04-04"
      const timeStr = tsDate.toTimeString().slice(0, 8);                    // "13:46:22"
      const now     = new Date();

      // 1. Update chat_messages (inbox outbound messages)
      await (db as any)
        .updateTable("chat_messages")
        .set({ status: deliveryStatus, updated_at: now })
        .where("message_id", "=", wamid)
        .where("username",   "=", username)
        .execute().catch(() => {});

      // 2. Update whatsapp_camp_details by whatsappid
      //    Sets status, delivery_date, delivery_time, updated_at
      await (db as any)
        .updateTable("whatsapp_camp_details")
        .set({
          status:        deliveryStatus,
          delivery_date: dateStr,
          delivery_time: timeStr,
          updated_at:    now,
        })
        .where("whatsappid", "=", wamid)
        .execute().catch(() => {});

      forwardToUrls(uuid, username, "whatsapp", payload).catch(() => {});
      return;
    }

    if (!message) return;

    // Skip unsupported message types (polls, etc.) — don't store or show to users
    if (message.type === "unsupported") {
      console.log(`[webhook-whatsapp] Skipped unsupported type: ${message?.unsupported?.type ?? "unknown"}`);
      return;
    }


    const messageId  = message.id   as string;
    const fromNumber = normalizePhone(message.from as string);
    const timestamp  = Number(message.timestamp ?? 0);
    const senderId   = displayNumber ? normalizePhone(displayNumber) : uuid;

    // ── Dedup ────────────────────────────────────────────────
    if (await isDuplicate(messageId)) {
      console.log(`[webhook-whatsapp] Duplicate skipped: ${messageId}`);
      return;
    }

    // ── Blacklist check ──────────────────────────────────────
    if (await isBlacklisted(username, fromNumber, "whatsapp")) {
      console.log(`[webhook-whatsapp] Blacklisted: ${fromNumber}`);
      return;
    }

    const content = extractContent(message);

    // ── Stop word → blacklist + opt_out automations ──────────
    if (content.type === "text" && content.text && isStopWord(content.text)) {
      await addToBlacklist(uuid, username, fromNumber, "whatsapp", content.text.toLowerCase());
      console.log(`[webhook-whatsapp] Stop word blacklisted: ${fromNumber}`);
      runOptOutAutomations({ uuid, username, phone: fromNumber, channel: "whatsapp" }).catch(() => {});
      return;
    }

    const conversationId = generateConversationId(uuid, "whatsapp", senderId, fromNumber);
    const preview = content.text
      ? content.text.slice(0, 200)
      : `[${content.type}]`;

    // ── Download media to local storage ──────────────────────
    let localMediaUrl:  string | null = null;
    let localMediaMime: string | null = content.mediaMime;
    let mediaSizeBytes: number | null = null;

    if (content.mediaId && MEDIA_TYPES.has(content.type)) {
      const downloaded = await downloadWhatsAppMedia({
        username,
        messageId,
        mediaId:   content.mediaId,
        mediaType: content.type,
        mediaMime: content.mediaMime,
      });
      if (downloaded) {
        localMediaUrl  = downloaded.mediaUrl;
        localMediaMime = downloaded.mimeType;
        mediaSizeBytes = downloaded.sizeBytes;
      }
    }

    // ── Save message ─────────────────────────────────────────
    await saveMessage({
      uuid, username,
      channel:            "whatsapp",
      conversation_id:    conversationId,
      message_id:         messageId,
      context_message_id: content.contextMessageId,
      sender_id:          senderId,
      receiver_id:        fromNumber,
      contact_name:       contactName,
      type:               content.type,
      text:               content.text,
      media_url:          localMediaUrl,
      media_id:           content.mediaId,
      media_mime:         localMediaMime,
      media_filename:     content.mediaFilename,
      media_size_bytes:   mediaSizeBytes,
      reaction_emoji:     content.reactionEmoji,
      location_lat:       content.locationLat,
      location_lng:       content.locationLng,
      location_name:      content.locationName,
      template_name:      content.templateName,
      direction:          "inbound",
      status:             "received",
      platform_timestamp: timestamp,
      phone_number_id:    phoneNumberId,
      raw_payload:        JSON.stringify(payload),
    });

    // ── Upsert sidebar summary ───────────────────────────────
    await upsertSummary({
      uuid, username,
      conversation_id:   conversationId,
      channel:           "whatsapp",
      sender_id:         senderId,
      receiver_id:       fromNumber,
      contact_name:      contactName,
      last_message:      preview,
      last_message_type: content.type,
      last_message_dir:  "inbound",
    });

    // ── Notify user of new inbound message ───────────────────
    notify({
      username,
      uuid,
      type:        "new_message",
      title:       `New message from ${contactName ?? fromNumber}`,
      description: preview ?? undefined,
      link:        `/inbox`,
    }).catch(() => {});

    // ── Forward to URLs (fire & forget) ─────────────────────
    forwardToUrls(uuid, username, "whatsapp", payload).catch(() => {});

    // ── First message detection (no prior conversation history) ─────────────
    const priorMessageCount: any = await (db as any)
      .selectFrom("chat_messages")
      .select((eb: any) => eb.fn.count("id").as("cnt"))
      .where("uuid",            "=", uuid)
      .where("conversation_id", "=", conversationId)
      .where("direction",       "=", "inbound")
      .executeTakeFirst();

    if (Number(priorMessageCount?.cnt ?? 0) <= 1) {
      // This is the first inbound message — fire first_message automations
      runFirstMessageAutomations({ uuid, username, phone: fromNumber, channel: "whatsapp" }).catch(() => {});
    }

    // ── Chatbot engine: run if user has active flows and message is text ──────
    if (content.type === "text" && content.text) {
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
          channel:       "whatsapp",
          conversationId,
          senderId: fromNumber,
          text:     content.text,
        }).catch((err: any) =>
          console.error(`[webhook-whatsapp] chatbot engine error:`, err?.message),
        );
      }
    }

    // ── Automation executor: keyword + button_reply triggers ─────────────────
    if (content.type === "text" && content.text) {
      runKeywordAutomations({ uuid, username, text: content.text, phone: fromNumber }).catch(() => {});
    }

    // Button reply / list reply
    if (content.type === "interactive") {
      const buttonId   = message?.interactive?.button_reply?.id   ?? message?.interactive?.list_reply?.id   ?? "";
      const buttonText = message?.interactive?.button_reply?.title ?? message?.interactive?.list_reply?.title ?? "";
      if (buttonId || buttonText) {
        runButtonReplyAutomations({ uuid, username, buttonId, buttonText, phone: fromNumber }).catch(() => {});
      }
    }

    console.log(`[webhook-whatsapp] OK | user=${username} from=${fromNumber} type=${content.type}`);
  },
  { connection: redisConnection as any, concurrency: 10 },
);

worker.on("failed", (job, err) =>
  console.error(`[webhook-whatsapp] Job ${job?.id} failed:`, err.message),
);

export default worker;
