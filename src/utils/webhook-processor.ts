import { createHash } from "crypto";
import axios from "axios";
import { sql } from "kysely";
import { db } from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";
import type { ChatMessage } from "../models/schema.js";
import { publishInboxEvent } from "./ws-publisher.js";
import { dispatchLead } from "./lead-dispatcher.js";

// ── Dedup TTL: 48 hours ───────────────────────────────────
const DEDUP_TTL_SECONDS = 48 * 60 * 60;

// ── Blacklist stop words ──────────────────────────────────
const STOP_WORDS = ["stop", "stop promotions", "unsubscribe", "end", "cancel"];

// ============================================================
// Normalize phone number: strip +, spaces, dashes → digits only
// ============================================================
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\+\(\)]/g, "");
}

// ============================================================
// Generate deterministic conversation ID
// ============================================================
export function generateConversationId(
  uuid: string,
  channel: string,
  senderId: string,
  receiverId: string,
): string {
  const key = `${uuid}:${channel}:${normalizePhone(senderId)}:${normalizePhone(receiverId)}`;
  return createHash("md5").update(key).digest("hex");
}

// ============================================================
// Redis deduplication — returns true if ALREADY processed
// ============================================================
export async function isDuplicate(messageId: string): Promise<boolean> {
  if (!messageId) return false;
  const key = `webhook:dedup:${messageId}`;
  const result = await (redisConnection as any).set(key, "1", "EX", DEDUP_TTL_SECONDS, "NX");
  return result === null; // null means key existed → duplicate
}

// ============================================================
// Blacklist check
// ============================================================
export async function isBlacklisted(
  username: string,
  phoneNumber: string,
  channel: string,
): Promise<boolean> {
  try {
    const row = await (db as any)
      .selectFrom("blacklist_numbers")
      .select("id")
      .where("username",     "=", username)
      .where("phone_number", "=", phoneNumber)
      .where("is_active",    "=", 1)
      .where((eb: any) =>
        eb.or([
          eb("channel", "=", channel),
          eb("channel", "=", "all"),
        ])
      )
      .executeTakeFirst();
    return !!row;
  } catch {
    return false;
  }
}

// ============================================================
// Add to blacklist (stop word triggered)
// ============================================================
export async function addToBlacklist(
  uuid: string,
  username: string,
  phoneNumber: string,
  channel: string,
  reason: string,
): Promise<void> {
  try {
    await (db as any)
      .insertInto("blacklist_numbers")
      .values({ uuid, username, phone_number: phoneNumber, channel, reason, is_active: 1 })
      .ignore()
      .execute();
  } catch { /* silently skip duplicate */ }
}

// ============================================================
// Check stop words in text
// ============================================================
export function isStopWord(text: string): boolean {
  return STOP_WORDS.includes(text.trim().toLowerCase());
}

// ============================================================
// Save message to chat_messages + publish WS event
// ============================================================
export async function saveMessage(msg: ChatMessage): Promise<number | null> {
  try {
    const result: any = await (db as any)
      .insertInto("chat_messages")
      .values({
        ...msg,
        metadata:    msg.metadata    ? JSON.stringify(msg.metadata)    : null,
        raw_payload: msg.raw_payload ? JSON.stringify(msg.raw_payload) : null,
        created_at:  new Date(),
        updated_at:  new Date(),
      })
      .execute();
    const insertId = Number(result.insertId) || null;

    // Auto-create / update lead for inbound messages (fire & forget)
    if (msg.direction === "inbound") {
      // For inbound messages:
      //   receiver_id = customer's phone (the person who messaged the business)
      //   sender_id   = the business/Meta account number
      const customerPhone = ["whatsapp", "rcs", "facebook", "instagram", "google"].includes(msg.channel)
        ? msg.receiver_id
        : null;
      const customerEmail = msg.channel === "email" ? msg.receiver_id : null;

      dispatchLead({
        uuid:         msg.uuid,
        username:     msg.username,
        channel:      msg.channel,
        phone:        customerPhone,
        email:        customerEmail,
        contact_name: msg.contact_name ?? null,
      }).catch((err: any) => {
        console.error("[webhook-processor] dispatchLead failed:", err?.message);
      });
    }

    // Publish real-time event (fire & forget)
    publishInboxEvent(msg.uuid, {
      type:            "new_message",
      id:              insertId,
      conversation_id: msg.conversation_id ?? null,
      channel:         msg.channel,
      message_id:      msg.message_id      ?? null,
      sender_id:       msg.sender_id,
      receiver_id:     msg.receiver_id,
      contact_name:    msg.contact_name    ?? null,
      msg_type:        msg.type,
      text:            msg.text            ?? null,
      media_url:       msg.media_url       ?? null,
      media_filename:  msg.media_filename  ?? null,
      direction:       msg.direction,
      status:          msg.status,
      created_at:      new Date().toISOString(),
    }).catch(() => {});

    return insertId;
  } catch (err: any) {
    console.error("[webhook-processor] saveMessage error:", err?.message);
    return null;
  }
}

// ============================================================
// Upsert chat_message_summary (sidebar row)
// ============================================================
export async function upsertSummary(params: {
  uuid:              string;
  username:          string;
  conversation_id:   string;
  channel:           string;
  sender_id:         string;
  receiver_id:       string;
  contact_name?:     string | null;
  last_message:      string | null;
  last_message_type: string;
  last_message_dir:  string;
}): Promise<void> {
  const now       = new Date();
  const isInbound = params.last_message_dir === "inbound";

  // session_message_time tracks the last INBOUND message time.
  // Meta's 24h session window starts from this timestamp.
  // Only update it when a customer sends a message (inbound).
  const sessionTime = isInbound ? now : null;

  try {
    await (db as any)
      .insertInto("chat_message_summary")
      .values({
        uuid:                params.uuid,
        username:            params.username,
        conversation_id:     params.conversation_id,
        channel:             params.channel,
        sender_id:           params.sender_id,
        receiver_id:         params.receiver_id,
        contact_name:        params.contact_name ?? null,
        last_message:        params.last_message,
        last_message_type:   params.last_message_type,
        last_message_at:     now,
        last_message_dir:    params.last_message_dir,
        session_message_time: sessionTime,
        is_read:             0,
        unread_count:        1,
        is_starred:          0,
        conv_status:         "open",
        created_at:          now,
        updated_at:          now,
      })
      .onDuplicateKeyUpdate({
        last_message:        params.last_message,
        last_message_type:   params.last_message_type,
        last_message_at:     now,
        last_message_dir:    params.last_message_dir,
        // Only refresh session window on inbound; keep existing value on outbound
        session_message_time: sql`IF(${params.last_message_dir} = 'inbound', ${now}, session_message_time)`,
        contact_name:        sql`COALESCE(${params.contact_name ?? null}, contact_name)`,
        // Only increment unread count for inbound messages; outbound resets to 0
        is_read:             isInbound ? 0 : 1,
        unread_count:        isInbound ? sql`unread_count + 1` : sql`unread_count`,
        updated_at:          now,
      })
      .execute();

    // Publish sidebar update event (fire & forget)
    publishInboxEvent(params.uuid, {
      type:              "conversation_update",
      conversation_id:   params.conversation_id,
      channel:           params.channel,
      sender_id:         params.sender_id,
      receiver_id:       params.receiver_id,
      contact_name:      params.contact_name ?? null,
      last_message:      params.last_message,
      last_message_type: params.last_message_type,
      last_message_dir:  params.last_message_dir,
      updated_at:        new Date().toISOString(),
    }).catch(() => {});
  } catch (err: any) {
    console.error("[webhook-processor] upsertSummary error:", err?.message);
  }
}

// ============================================================
// Forward payload to all registered URLs for this user+channel
// ============================================================
export async function forwardToUrls(
  uuid:     string,
  username: string,
  channel:  string,
  payload:  any,
): Promise<void> {
  try {
    const urls: any[] = await (db as any)
      .selectFrom("webhook_forward_urls")
      .select(["id", "url"])
      .where("username", "=", username)
      .where("status",   "=", "active")
      .where((eb: any) =>
        eb.or([
          eb("channel", "=", channel),
          eb("channel", "=", "all"),
        ])
      )
      .execute();

    if (!urls.length) return;

    const requestPayload = JSON.stringify(payload);

    await Promise.allSettled(
      urls.map(async (row) => {
        let responseBody: string | null = null;
        let httpStatus:   number | null = null;
        let success = 0;
        let errorMsg: string | null = null;

        try {
          const res = await axios.post(row.url, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000,
            validateStatus: () => true,
          });
          httpStatus   = res.status;
          responseBody = JSON.stringify(res.data).slice(0, 2000);
          success      = res.status >= 200 && res.status < 300 ? 1 : 0;
        } catch (err: any) {
          errorMsg = err?.message?.slice(0, 500) ?? "unknown error";
        }

        // Fire & forget log
        (db as any)
          .insertInto("webhook_outbound_logs")
          .values({
            uuid,
            username,
            channel,
            forward_url:     row.url,
            request_payload: requestPayload,
            response_body:   responseBody,
            http_status:     httpStatus,
            success,
            error_message:   errorMsg,
            created_at:      new Date(),
          })
          .execute()
          .catch(() => {});
      }),
    );
  } catch (err: any) {
    console.error("[webhook-processor] forwardToUrls error:", err?.message);
  }
}
