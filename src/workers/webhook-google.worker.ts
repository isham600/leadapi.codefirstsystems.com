import { Worker } from "bullmq";
import { redisConnection } from "../queues/campaign.queue.js";
import type { WebhookJobData } from "../queues/webhook.queue.js";
import {
  generateConversationId,
  isDuplicate,
  saveMessage,
  upsertSummary,
  forwardToUrls,
} from "../utils/webhook-processor.js";
import { dispatchLead } from "../utils/lead-dispatcher.js";

// ── Detect payload type ────────────────────────────────────────
// Google Ads Lead Form has `user_column_data` array + `lead_id`
// Google Business Messages has `message` object with `text`/`sendTime`
function isGoogleAdsLeadForm(payload: any): boolean {
  return Array.isArray(payload?.user_column_data) && !!payload?.lead_id;
}

// ── Parse Google Ads Lead Form ─────────────────────────────────
// Payload: https://developers.google.com/google-ads/lead-form-extensions/webhook
function parseGoogleAdsLead(payload: any) {
  const cols: { column_name: string; string_value: string }[] =
    payload.user_column_data ?? [];

  const get = (name: string): string | null =>
    cols.find((c) => c.column_name === name)?.string_value?.trim() || null;

  const firstName = get("FIRST_NAME");
  const lastName  = get("LAST_NAME");
  const fullName  = get("FULL_NAME")
    ?? (firstName || lastName ? `${firstName ?? ""} ${lastName ?? ""}`.trim() : null);

  return {
    leadId:       String(payload.lead_id),
    name:         fullName,
    phone:        get("PHONE_NUMBER"),
    email:        get("EMAIL") ?? get("WORK_EMAIL"),
    city:         get("CITY"),
    postalCode:   get("POSTAL_CODE"),
    country:      get("COUNTRY"),
    jobTitle:     get("JOB_TITLE"),
    companyName:  get("COMPANY_NAME"),
    campaignId:   payload.campaign_id   ? String(payload.campaign_id)  : null,
    campaignName: payload.campaign_name ?? null,
    adgroupName:  payload.adgroup_name  ?? null,
    gclId:        payload.gcl_id        ?? null,
    isTest:       payload.is_test       === true,
  };
}

// ── Parse Google Business Messages ────────────────────────────
function parseGBMPayload(payload: any) {
  try {
    const message   = payload?.message ?? payload;
    const messageId = message?.name ?? message?.messageId ?? null;
    const senderId  = message?.senderPhoneNumber
                   ?? message?.sender?.displayName
                   ?? null;
    const agentId   = payload?.agent ?? payload?.agentId ?? null;

    // Suggestion chip reply
    if (message?.suggestionResponse) {
      return {
        messageId,
        senderId,
        agentId,
        text:      message.suggestionResponse.text ?? message.suggestionResponse.postbackData ?? "[suggestion]",
        imageUrl:  null,
        type:      "suggestion" as const,
        timestamp: message?.sendTime ?? null,
      };
    }

    const text     = message?.text ?? null;
    const imageUrl = message?.image?.contentInfo?.fileUrl ?? null;
    const type     = imageUrl ? "image" as const : text ? "text" as const : "unknown" as const;

    return { messageId, senderId, agentId, text, imageUrl, type, timestamp: message?.sendTime ?? null };
  } catch {
    return null;
  }
}

// ── Worker ─────────────────────────────────────────────────────
const worker = new Worker<WebhookJobData>(
  "webhook-google",
  async (job) => {
    const { uuid, username, payload } = job.data;

    // ════════════════════════════════════════════════════════════
    // PATH A — Google Ads Lead Form submission
    // ════════════════════════════════════════════════════════════
    if (isGoogleAdsLeadForm(payload)) {
      const lead = parseGoogleAdsLead(payload);

      // Skip test submissions in production (optional: remove to keep test leads)
      if (lead.isTest) {
        console.log(`[webhook-google] Test lead skipped: ${lead.leadId}`);
        return;
      }

      if (!lead.phone && !lead.email) {
        console.log(`[webhook-google] Lead ${lead.leadId} has no phone or email — skipped`);
        return;
      }

      const messageId      = `google_lead_${lead.leadId}`;
      const receiverId     = lead.phone ?? lead.email ?? lead.leadId;
      const senderId       = lead.campaignId ?? uuid;
      const conversationId = generateConversationId(uuid, "google", senderId, receiverId);

      if (await isDuplicate(messageId)) {
        console.log(`[webhook-google] Duplicate lead skipped: ${messageId}`);
        return;
      }

      // Build a readable summary of all form fields
      const fieldLines = (payload.user_column_data as any[])
        .map((c: any) => `${c.column_name}: ${c.string_value}`)
        .join(", ");

      const preview = `[Google Ads Lead] ${lead.name ?? ""} ${lead.phone ?? ""} ${lead.email ?? ""}`.trim();

      const metadata = JSON.stringify({
        lead_id:       lead.leadId,
        campaign_id:   lead.campaignId,
        campaign_name: lead.campaignName,
        adgroup_name:  lead.adgroupName,
        gcl_id:        lead.gclId,
        fields:        fieldLines,
      });

      // Save to inbox
      await saveMessage({
        uuid, username,
        channel:         "google",
        conversation_id: conversationId,
        message_id:      messageId,
        sender_id:       senderId,
        receiver_id:     receiverId,
        contact_name:    lead.name,
        type:            "lead",
        text:            preview,
        direction:       "inbound",
        status:          "received",
        metadata,
        raw_payload:     JSON.stringify(payload),
      });

      await upsertSummary({
        uuid, username,
        conversation_id:   conversationId,
        channel:           "google",
        sender_id:         senderId,
        receiver_id:       receiverId,
        contact_name:      lead.name,
        last_message:      preview,
        last_message_type: "lead",
        last_message_dir:  "inbound",
      });

      // Dispatch to lead-dispatcher with full form data
      await dispatchLead({
        uuid,
        username,
        channel:      "google",
        phone:        lead.phone,
        email:        lead.email,
        contact_name: lead.name,
        city:         lead.city,
        country_code: lead.country,
        sub_source:   lead.campaignName ?? lead.campaignId ?? null,
      });

      forwardToUrls(uuid, username, "google", payload).catch(() => {});

      console.log(`[webhook-google] Lead OK | user=${username} id=${lead.leadId} name=${lead.name} phone=${lead.phone} email=${lead.email} city=${lead.city}`);
      return;
    }

    // ════════════════════════════════════════════════════════════
    // PATH B — Google Business Messages (RBM / chat)
    // ════════════════════════════════════════════════════════════
    const parsed = parseGBMPayload(payload);
    if (!parsed || parsed.type === "unknown") return;

    const messageId  = parsed.messageId ?? `google_${Date.now()}`;
    const receiverId = parsed.senderId  ?? "unknown";
    const senderId   = parsed.agentId   ?? uuid;

    if (await isDuplicate(messageId)) {
      console.log(`[webhook-google] Duplicate skipped: ${messageId}`);
      return;
    }

    const conversationId = generateConversationId(uuid, "google", senderId, receiverId);
    const preview = parsed.type === "text" || parsed.type === "suggestion"
      ? (parsed.text?.slice(0, 200) ?? null)
      : `[${parsed.type}]`;

    await saveMessage({
      uuid, username,
      channel:         "google",
      conversation_id: conversationId,
      message_id:      messageId,
      sender_id:       senderId,
      receiver_id:     receiverId,
      type:            parsed.type,
      text:            parsed.text,
      media_url:       parsed.imageUrl,
      direction:       "inbound",
      status:          "received",
      raw_payload:     JSON.stringify(payload),
    });

    await upsertSummary({
      uuid, username,
      conversation_id:   conversationId,
      channel:           "google",
      sender_id:         senderId,
      receiver_id:       receiverId,
      last_message:      preview,
      last_message_type: parsed.type,
      last_message_dir:  "inbound",
    });

    forwardToUrls(uuid, username, "google", payload).catch(() => {});

    console.log(`[webhook-google] GBM OK | user=${username} from=${receiverId} type=${parsed.type}`);
  },
  { connection: redisConnection as any, concurrency: 10 },
);

worker.on("failed", (job, err) =>
  console.error(`[webhook-google] Job ${job?.id} failed:`, err.message),
);

export default worker;
