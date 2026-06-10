import { db } from "../models/db.js";
import { leadDispatcherQueue, type LeadJobData } from "../queues/webhook.queue.js";

// ============================================================
// Lead Dispatcher
//
// dispatchLead()   → pushes a BullMQ job to `lead-dispatcher`
//                    (fire-and-forget, called from webhook workers)
//
// processLeadJob() → actual DB logic, executed inside the worker
//
// Dedup rules (per username):
//   1. Same phone + same channel (source) → existing lead
//   2. Same email                         → existing lead
//   3. Otherwise                          → create new lead
//
// Lead Score points:
//   INITIAL          +10  (new lead base)
//   HAS_NAME         + 2  (contact name known)
//   HAS_PHONE        + 3  (phone captured)
//   HAS_EMAIL        + 5  (email captured)
//   INBOUND_MESSAGE  + 2  (each inbound message on existing lead)
// ============================================================

export const SCORE = {
  INITIAL:          10,
  HAS_NAME:          2,
  HAS_PHONE:         3,
  HAS_EMAIL:         5,
  INBOUND_MESSAGE:   2,
} as const;

// ── Queue publisher ───────────────────────────────────────────

export async function dispatchLead(input: LeadJobData): Promise<void> {
  await leadDispatcherQueue.add(
    `lead-${input.username}-${Date.now()}`,
    input,
    { priority: 5 },
  );
}

// ── DB processing (runs inside lead-dispatcher.worker.ts) ─────

function splitName(name: string | null | undefined) {
  if (!name?.trim()) return { first: "Unknown", last: null, full: null };
  const parts = name.trim().split(/\s+/);
  return {
    first: parts[0],
    last:  parts.length > 1 ? parts.slice(1).join(" ") : null,
    full:  name.trim(),
  };
}

// Strip leading + from phone (e.g. "+919714354066" → "919714354066")
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return raw.trim().replace(/^\+/, "");
}

export async function processLeadJob(input: LeadJobData): Promise<void> {
  const { username, channel, country_code, sub_source, city } = input;
  const phone = normalizePhone(input.phone);
  const email = input.email?.trim() || null;
  const name  = input.contact_name?.trim() || null;

  if (!phone && !email) return;

  const now = new Date();

  // ── 1a. Dedup: same phone + same channel (exact match — update, not duplicate)
  //        Prefer the primary (is_duplicate=0) lead; fall back to any match
  let existing: any = null;

  if (phone) {
    existing = await (db as any)
      .selectFrom("leads")
      .select(["id", "lead_score", "email", "full_name", "phone", "source"])
      .where("username",     "=", username)
      .where("phone",        "=", phone)
      .where("source",       "=", channel)
      .where("is_duplicate", "=", 0)
      .orderBy("id", "desc")
      .executeTakeFirst();

    // If only a duplicate row exists for this channel, still use it
    if (!existing) {
      existing = await (db as any)
        .selectFrom("leads")
        .select(["id", "lead_score", "email", "full_name", "phone", "source"])
        .where("username", "=", username)
        .where("phone",    "=", phone)
        .where("source",   "=", channel)
        .orderBy("id", "desc")
        .executeTakeFirst();
    }
  }

  // ── 1b. If no same-channel match, check for cross-channel duplicate ───
  let crossChannelExists = false;
  if (!existing && phone) {
    const crossChannel: any = await (db as any)
      .selectFrom("leads")
      .select(["id", "lead_score", "email", "full_name", "phone", "source"])
      .where("username",     "=", username)
      .where("phone",        "=", phone)
      .where("is_duplicate", "=", 0)   // only match against primary lead
      .orderBy("id", "desc")
      .executeTakeFirst();

    if (crossChannel) {
      // Same phone, different channel — mark as duplicate but still update score
      crossChannelExists = true;
      existing = crossChannel;
    }
  }

  // ── 2. Fallback dedup by email ────────────────────────────
  if (!existing && email) {
    existing = await (db as any)
      .selectFrom("leads")
      .select(["id", "lead_score", "email", "full_name", "phone", "source"])
      .where("username", "=", username)
      .where("email",    "=", email)
      .executeTakeFirst();
  }

  // ── 3. UPDATE existing lead ───────────────────────────────
  if (existing) {
    let newScore = (Number(existing.lead_score) || 0) + SCORE.INBOUND_MESSAGE;

    const enrichment: Record<string, any> = {
      lead_score:       newScore,
      last_activity_at: now,
      updated_at:       now,
    };

    // Enrich name if previously unknown
    if (name && (!existing.full_name || existing.full_name === "Unknown")) {
      const n = splitName(name);
      enrichment.first_name = n.first;
      enrichment.last_name  = n.last;
      enrichment.full_name  = n.full;
      newScore             += SCORE.HAS_NAME;
      enrichment.lead_score = newScore;
    }

    // Enrich email (one-time bonus)
    if (email && !existing.email) {
      enrichment.email      = email;
      newScore             += SCORE.HAS_EMAIL;
      enrichment.lead_score = newScore;
    }

    // Enrich phone (one-time bonus, normalized)
    if (phone && !existing.phone) {
      enrichment.phone      = phone;
      newScore             += SCORE.HAS_PHONE;
      enrichment.lead_score = newScore;
    }

    await (db as any)
      .updateTable("leads")
      .set(enrichment)
      .where("id", "=", existing.id)
      .execute();

    // Cross-channel: also insert a new row marked is_duplicate=1
    // so this channel's activity is recorded separately
    if (crossChannelExists) {
      const { first, last, full } = splitName(name);
      let dupScore = SCORE.INITIAL;
      if (name)  dupScore += SCORE.HAS_NAME;
      if (phone) dupScore += SCORE.HAS_PHONE;
      if (email) dupScore += SCORE.HAS_EMAIL;

      await (db as any)
        .insertInto("leads")
        .values({
          username,
          first_name:       first,
          last_name:        last,
          full_name:        full ?? phone ?? email ?? "Unknown",
          email,
          phone,
          city:             city ?? null,
          country_code:     country_code ?? null,
          status:           "NEW",
          lifecycle:        "lead",
          priority:         "Medium",
          source:           channel,
          sub_source:       sub_source ?? null,
          lead_score:       dupScore,
          last_activity_at: now,
          is_duplicate:     1,
          is_converted:     0,
          is_archived:      0,
          created_by:       username,
          updated_by:       username,
          created_at:       now,
          updated_at:       now,
        })
        .execute();
    }

    return;
  }

  // ── 4. INSERT new lead (first time seen) ──────────────────
  const { first, last, full } = splitName(name);

  let initialScore = SCORE.INITIAL;
  if (name)  initialScore += SCORE.HAS_NAME;
  if (phone) initialScore += SCORE.HAS_PHONE;
  if (email) initialScore += SCORE.HAS_EMAIL;

  // For WhatsApp: check if phone was targeted by a campaign → use template_id as sub_source
  let resolvedSubSource = sub_source ?? null;
  if (!resolvedSubSource && channel === "whatsapp" && phone) {
    try {
      const bare   = phone.replace(/^91/, "");
      const withCC = `91${bare}`;
      const campRow: any = await (db as any)
        .selectFrom("whatsapp_camp_details")
        .select(["template_id"])
        .where((eb: any) => eb.or([
          eb("receiver", "=", phone),
          eb("receiver", "=", bare),
          eb("receiver", "=", withCC),
        ]))
        .orderBy("created_at", "desc")
        .executeTakeFirst();
      if (campRow?.template_id) {
        resolvedSubSource = campRow.template_id as string;
      }
    } catch { /* non-critical */ }
  }

  await (db as any)
    .insertInto("leads")
    .values({
      username,
      first_name:       first,
      last_name:        last,
      full_name:        full ?? phone ?? email ?? "Unknown",
      email,
      phone,
      city:             city ?? null,
      country_code:     country_code ?? null,
      status:           "NEW",
      stage:            "New",
      lifecycle:        "lead",
      priority:         "Medium",
      source:           channel,
      sub_source:       resolvedSubSource,
      lead_score:       initialScore,
      last_activity_at: now,
      is_duplicate:     0,
      is_converted:     0,
      is_archived:      0,
      created_by:       username,
      updated_by:       username,
      created_at:       now,
      updated_at:       now,
    })
    .execute();
}

// ============================================================
// recalcLeadScore — full recalculation (admin / reconciliation)
// ============================================================
export async function recalcLeadScore(leadId: number): Promise<number> {
  try {
    const lead: any = await (db as any)
      .selectFrom("leads")
      .select(["id", "phone", "email", "full_name"])
      .where("id", "=", leadId)
      .executeTakeFirst();

    if (!lead) return 0;

    const activityRow: any = await (db as any)
      .selectFrom("lead_activities")
      .select((eb: any) => eb.fn.count("id").as("cnt"))
      .where("lead_id", "=", leadId)
      .executeTakeFirst();

    const messageCount = Number(activityRow?.cnt ?? 0);

    let score = SCORE.INITIAL;
    if (lead.full_name && lead.full_name !== "Unknown") score += SCORE.HAS_NAME;
    if (lead.phone)  score += SCORE.HAS_PHONE;
    if (lead.email)  score += SCORE.HAS_EMAIL;
    score += messageCount * SCORE.INBOUND_MESSAGE;

    await (db as any)
      .updateTable("leads")
      .set({ lead_score: score, updated_at: new Date() })
      .where("id", "=", leadId)
      .execute();

    return score;
  } catch (err: any) {
    console.error("[lead-dispatcher] recalcLeadScore error:", err?.message);
    return 0;
  }
}
