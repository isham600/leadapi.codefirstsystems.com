import { db } from "../../../models/db.js";
import { notify, getUuidByUsername } from "../../../utils/notify.js";
import { runEventAutomations } from "../../../utils/automation-executor.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Meta lead ingestion service
// Single source of truth used by BOTH the realtime webhook
// (meta.controller.ts) and the bulk sync worker (meta-sync.worker.ts), so a
// lead gets identical normalization / dedup / scoring no matter which path
// it arrives through. (P0-2 / P0-3 fix)
// ─────────────────────────────────────────────────────────────────────────────

export const SCORE = { INITIAL: 10, HAS_NAME: 2, HAS_PHONE: 3, HAS_EMAIL: 5, INBOUND_MESSAGE: 2 } as const;

// Graph API field sets for the Lead node. FULL includes campaign/adset/ad
// attribution (needs ads_read on the token); callers should retry with BASIC
// when FULL is rejected so organic-lead fetching never breaks.
export const LEAD_FIELDS_FULL  = "id,created_time,field_data,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name";
export const LEAD_FIELDS_BASIC = "id,created_time,field_data";

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const cleaned = raw.trim().replace(/^\+/, "").replace(/[\s\-().]/g, "");
  // Only keep if it looks like a phone number (digits only, 5–20 chars)
  if (!/^\d{5,20}$/.test(cleaned)) return null;
  return cleaned;
}

export function splitName(name: string | null | undefined) {
  if (!name?.trim()) return { first: "Unknown", last: null as string | null, full: null as string | null };
  const parts = name.trim().split(/\s+/);
  return {
    first: parts[0],
    last:  parts.length > 1 ? parts.slice(1).join(" ") : null,
    full:  name.trim(),
  };
}

export function parseFieldData(fieldData: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldData ?? []) {
    if (f.name) out[f.name.toLowerCase()] = f.values?.[0] ?? "";
  }
  return out;
}

/**
 * Canonical tenant resolver — users.uuid is the tenant key used by all
 * existing leads and the rest of the codebase (auth/webhook middleware).
 * Falls back to username if the user row is missing.
 */
export async function resolveTenantId(username: string): Promise<string> {
  const row: any = await (db as any)
    .selectFrom("users")
    .select(["uuid"])
    .where("username", "=", username)
    .executeTakeFirst();
  return row?.uuid ?? username;
}

/** Shape of a lead object coming from the Graph API Lead node. */
export interface MetaGraphLead {
  id: string;
  created_time?: string;
  field_data?: any[];
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
}

function attributionFields(lead: MetaGraphLead): Record<string, string | null> {
  return {
    meta_campaign_id:   lead.campaign_id   ?? null,
    meta_campaign_name: lead.campaign_name ?? null,
    meta_adset_id:      lead.adset_id      ?? null,
    meta_adset_name:    lead.adset_name    ?? null,
    meta_ad_id:         lead.ad_id         ?? null,
    meta_ad_name:       lead.ad_name       ?? null,
  };
}

export type UpsertResult = "inserted" | "updated" | "skipped";

// ─────────────────────────────────────────────────────────────────────────────
// Conversions API — push CRM lead-status changes back to Meta so ad delivery
// optimizes for lead QUALITY, not just volume. Uses the dataset/pixel ID
// configured on the Meta account; identifies the person via meta_lead_id
// (the supported CRM-integration identifier — no PII needs to be sent).
// ─────────────────────────────────────────────────────────────────────────────

const CAPI_EVENT_BY_STATUS: Record<string, string> = {
  qualified: "QualifiedLead",
  converted: "ConvertedLead",
  won:       "ConvertedLead",
  customer:  "ConvertedLead",
  lost:      "LostLead",
  closed:    "LostLead",
  junk:      "DisqualifiedLead",
  disqualified: "DisqualifiedLead",
};

/**
 * Fire-and-forget CAPI lead event for a CRM lead. No-ops silently when the
 * lead isn't a Meta lead or no pixel/dataset ID is configured.
 */
export async function sendMetaCapiLeadEvent(
  username: string,
  crmLeadId: number,
  status: string,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const lead: any = await (db as any)
      .selectFrom("leads")
      .select(["meta_lead_id"])
      .where("id", "=", crmLeadId)
      .where("username", "=", username)
      .executeTakeFirst();
    if (!lead?.meta_lead_id) return { sent: false, reason: "not a Meta lead" };

    const acct: any = await (db as any)
      .selectFrom("meta_accounts")
      .select(["pixel_id", "access_token"])
      .where("username", "=", username)
      .where("status", "=", "active")
      .orderBy("id", "desc")
      .executeTakeFirst();
    if (!acct?.pixel_id || !acct?.access_token) return { sent: false, reason: "no pixel_id configured" };

    const eventName = CAPI_EVENT_BY_STATUS[status?.toLowerCase?.() ?? ""] ?? "LeadStatusUpdate";

    const res = await fetch(
      `https://graph.facebook.com/v25.0/${acct.pixel_id}/events?access_token=${encodeURIComponent(acct.access_token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [{
            event_name:    eventName,
            event_time:    Math.floor(Date.now() / 1000),
            action_source: "system_generated",
            user_data:     { lead_id: lead.meta_lead_id },
            custom_data:   { event_source: "crm", lead_event_source: "LeadCRM", crm_status: status },
          }],
        }),
      }
    );
    const json: any = await res.json();
    if (json.error) {
      console.error("[metaCapi] event failed:", json.error.message);
      return { sent: false, reason: json.error.message };
    }
    return { sent: true };
  } catch (err: any) {
    console.error("[metaCapi] error:", err?.message);
    return { sent: false, reason: err?.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Field mapping — meta_form_field_map rows route custom question answers
// into real lead columns (allowlisted to prevent arbitrary column writes)
// ─────────────────────────────────────────────────────────────────────────────

export const CRM_FIELD_ALLOWLIST = ["city", "country_code", "campaign", "term", "content", "lead_value", "priority"] as const;

export async function loadFieldMap(username: string, formId: string): Promise<Record<string, string>> {
  try {
    const rows: any[] = await (db as any)
      .selectFrom("meta_form_field_map")
      .select(["meta_field", "crm_field"])
      .where("username", "=", username)
      .where("form_id",  "=", formId)
      .execute();
    const map: Record<string, string> = {};
    for (const r of rows) {
      if ((CRM_FIELD_ALLOWLIST as readonly string[]).includes(r.crm_field)) {
        map[String(r.meta_field).toLowerCase()] = r.crm_field;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function applyFieldMap(fields: Record<string, string>, map: Record<string, string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [metaField, crmField] of Object.entries(map)) {
    const v = fields[metaField];
    if (v === undefined || v === "") continue;
    out[crmField] = crmField === "lead_value" ? (Number(v) || null) : v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing — round-robin across the owner's team agents (team_members table).
// Opt-in by having a team: no agents configured → no auto-assignment.
// ─────────────────────────────────────────────────────────────────────────────

async function pickNextAgent(username: string): Promise<string | null> {
  try {
    const agents: any[] = await (db as any)
      .selectFrom("team_members")
      .select(["agent_username"])
      .where("owner_username", "=", username)
      .orderBy("id", "asc")
      .execute();
    if (!agents.length) return null;
    const names = agents.map((a) => a.agent_username);

    const last: any = await (db as any)
      .selectFrom("leads")
      .select(["assigned_agent"])
      .where("username", "=", username)
      .where("assigned_agent", "in", names)
      .orderBy("id", "desc")
      .executeTakeFirst();

    if (!last?.assigned_agent) return names[0];
    const idx = names.indexOf(last.assigned_agent);
    return names[(idx + 1) % names.length];
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-insert hooks: assignment + instant notification + new_lead automations
// (welcome WhatsApp etc. via the user's configured automations).
// All best-effort — must never break lead capture.
// ─────────────────────────────────────────────────────────────────────────────

async function afterNewMetaLead(params: {
  username:     string;
  leadId:       number | null;
  name:         string | null;
  phone:        string | null;
  formName?:    string | null;
  campaignName?: string | null;
  createdAt:    Date;
  fireHooks:    boolean;
}): Promise<void> {
  const { username, leadId, name, phone, formName, campaignName, createdAt, fireHooks } = params;
  const label = name ?? phone ?? "Unknown";

  // 1. Round-robin assignment (also for backfilled leads — harmless and useful)
  let assignedAgent: string | null = null;
  try {
    assignedAgent = await pickNextAgent(username);
    if (assignedAgent && leadId) {
      await (db as any)
        .updateTable("leads")
        .set({ assigned_agent: assignedAgent, updated_at: new Date() })
        .where("id", "=", leadId)
        .execute();
    }
  } catch (err: any) {
    console.error("[metaLead] assignment failed:", err?.message);
  }

  // Notifications + automations only for fresh leads (skip bulk backfill —
  // a 2-year-old lead arriving via "Sync Leads" must not spam reps)
  const isFresh = Date.now() - createdAt.getTime() < 24 * 60 * 60 * 1000;
  if (!fireHooks || !isFresh) return;

  const uuid = (await getUuidByUsername(username)) ?? undefined;
  const sourceLabel = campaignName ? `campaign "${campaignName}"` : formName ? `form "${formName}"` : "Meta lead ads";

  // 2. Instant in-app + WebSocket notification (owner, and agent if different)
  const recipients = new Set([username, ...(assignedAgent ? [assignedAgent] : [])]);
  for (const recipient of recipients) {
    notify({
      username:    recipient,
      uuid:        recipient === username ? uuid : (await getUuidByUsername(recipient)) ?? undefined,
      type:        "new_lead",
      title:       `New Meta lead: ${label}`,
      description: `Captured from ${sourceLabel}${assignedAgent ? ` · assigned to ${assignedAgent}` : ""}`,
      link:        "/leads",
    }).catch(() => {});
  }

  // 3. User-configured new_lead automations (assign/tag/stage/welcome WhatsApp)
  if (uuid) {
    runEventAutomations({
      uuid,
      username,
      triggerType: "new_lead",
      eventLabel:  `New Meta lead: ${label} (${sourceLabel})`,
      phone:       phone ?? undefined,
      lead_id:     leadId ?? undefined,
    }).catch(() => {});
  }
}

/**
 * Upsert one Meta lead into the lead manager.
 *
 * Dedup order:
 *  1. meta_lead_id            — already ingested (webhook or earlier sync): enrich only
 *  2. phone + source="meta"   — same channel, same phone: update + score bump
 *  3. phone, any source       — cross-channel: update + record duplicate row
 *  4. email, any source       — update + score bump
 *  else                       — insert new scored lead
 */
export async function upsertMetaLead(params: {
  username:   string;
  tenantId:   string;
  formId:     string;
  formName?:  string | null;
  lead:       MetaGraphLead;
  rawPayload?: string | null;
  /** Fire post-insert hooks (notify/automations) — default true; backfill-age leads are auto-skipped */
  fireHooks?: boolean;
}): Promise<UpsertResult> {
  const { username, tenantId, formId, formName, lead, rawPayload, fireHooks = true } = params;
  const now = new Date();

  const metaLeadId = String(lead.id);
  const fields     = parseFieldData(lead.field_data ?? []);
  const phone      = normalizePhone(fields["phone_number"] || fields["phone"]);
  const email      = (fields["email"] || "").trim() || null;
  const name       = fields["full_name"] || fields["name"] || null;
  const createdAt  = lead.created_time ? new Date(lead.created_time) : now;
  const attribution = attributionFields(lead);

  if (!phone && !email) return "skipped";

  // Custom question answers → mapped CRM columns (per-form config)
  const mapped = applyFieldMap(fields, await loadFieldMap(username, formId));

  // ── 1. Primary dedup: meta_lead_id (already synced from webhook or a previous run)
  const byMetaId: any = await (db as any)
    .selectFrom("leads")
    .select(["id", "email", "full_name", "phone", "meta_campaign_id"])
    .where("username",     "=", username)
    .where("meta_lead_id", "=", metaLeadId)
    .executeTakeFirst();

  if (byMetaId) {
    // Already ingested — enrich missing fields only, no score bump
    const enrichment: Record<string, any> = { updated_at: now };
    if (name && (!byMetaId.full_name || byMetaId.full_name === "Unknown")) {
      const n = splitName(name);
      enrichment.first_name = n.first;
      enrichment.last_name  = n.last;
      enrichment.full_name  = n.full;
    }
    if (email && !byMetaId.email) enrichment.email = email;
    if (phone && !byMetaId.phone) enrichment.phone = phone;
    if (attribution.meta_campaign_id && !byMetaId.meta_campaign_id) Object.assign(enrichment, attribution);
    if (Object.keys(enrichment).length > 1) {
      await (db as any).updateTable("leads").set(enrichment).where("id", "=", byMetaId.id).execute();
    }
    return "updated";
  }

  // ── 2. Dedup by phone + source="meta" (same channel, same phone)
  let existing: any = null;
  if (phone) {
    existing = await (db as any)
      .selectFrom("leads")
      .select(["id", "lead_score", "email", "full_name", "phone", "meta_lead_id"])
      .where("username",     "=", username)
      .where("phone",        "=", phone)
      .where("source",       "=", "meta")
      .where("is_duplicate", "=", 0)
      .orderBy("id", "desc")
      .executeTakeFirst();
  }

  // ── 3. Cross-channel dedup by phone (different source, same phone)
  let isCrossChannel = false;
  if (!existing && phone) {
    const crossChannel: any = await (db as any)
      .selectFrom("leads")
      .select(["id", "lead_score", "email", "full_name", "phone", "meta_lead_id"])
      .where("username",     "=", username)
      .where("phone",        "=", phone)
      .where("is_duplicate", "=", 0)
      .orderBy("id", "desc")
      .executeTakeFirst();
    if (crossChannel) {
      isCrossChannel = true;
      existing = crossChannel;
    }
  }

  // ── 4. Dedup by email (any source)
  if (!existing && email) {
    existing = await (db as any)
      .selectFrom("leads")
      .select(["id", "lead_score", "email", "full_name", "phone", "meta_lead_id"])
      .where("username", "=", username)
      .where("email",    "=", email)
      .executeTakeFirst();
  }

  if (existing) {
    // ── UPDATE existing lead ─────────────────────────────
    let newScore = (Number(existing.lead_score) || 0) + SCORE.INBOUND_MESSAGE;
    const enrichment: Record<string, any> = {
      lead_score:       newScore,
      last_activity_at: createdAt,
      updated_at:       now,
      // Tag with meta IDs + attribution if not already a meta lead
      ...(!existing.meta_lead_id ? { meta_lead_id: metaLeadId, meta_form_id: formId, medium: "facebook_lead_ads", ...attribution } : {}),
    };

    if (name && (!existing.full_name || existing.full_name === "Unknown")) {
      const n = splitName(name);
      enrichment.first_name = n.first;
      enrichment.last_name  = n.last;
      enrichment.full_name  = n.full;
      newScore             += SCORE.HAS_NAME;
      enrichment.lead_score = newScore;
    }
    if (email && !existing.email) {
      enrichment.email      = email;
      newScore             += SCORE.HAS_EMAIL;
      enrichment.lead_score = newScore;
    }
    if (phone && !existing.phone) {
      enrichment.phone      = phone;
      newScore             += SCORE.HAS_PHONE;
      enrichment.lead_score = newScore;
    }

    await (db as any).updateTable("leads").set(enrichment).where("id", "=", existing.id).execute();

    // Cross-channel: also insert a duplicate row so this Meta entry is recorded
    if (isCrossChannel) {
      const { first, last, full } = splitName(name);
      let dupScore = SCORE.INITIAL;
      if (name)  dupScore += SCORE.HAS_NAME;
      if (phone) dupScore += SCORE.HAS_PHONE;
      if (email) dupScore += SCORE.HAS_EMAIL;

      await (db as any).insertInto("leads").values({
        tenant_id:        tenantId,
        username,
        first_name:       first,
        last_name:        last,
        full_name:        full ?? phone ?? email ?? "Unknown",
        email,
        phone,
        source:           "meta",
        medium:           "facebook_lead_ads",
        sub_source:       formName ?? null,
        meta_lead_id:     metaLeadId,
        meta_form_id:     formId,
        ...attribution,
        ...mapped,
        ...(rawPayload ? { raw_payload: rawPayload } : {}),
        lead_score:       dupScore,
        status:           "NEW",
        lifecycle:        "lead",
        priority:         (mapped as any).priority ?? "Medium",
        last_activity_at: createdAt,
        is_duplicate:     1,
        is_converted:     0,
        is_archived:      0,
        created_by:       username,
        updated_by:       username,
        created_at:       createdAt,
        updated_at:       now,
      }).execute();
    }

    return "updated";
  }

  // ── INSERT new lead ──────────────────────────────────
  const { first, last, full } = splitName(name);
  let initialScore = SCORE.INITIAL;
  if (name)  initialScore += SCORE.HAS_NAME;
  if (phone) initialScore += SCORE.HAS_PHONE;
  if (email) initialScore += SCORE.HAS_EMAIL;

  const insertRes: any = await (db as any).insertInto("leads").values({
    tenant_id:        tenantId,
    username,
    first_name:       first,
    last_name:        last,
    full_name:        full ?? phone ?? email ?? "Unknown",
    email,
    phone,
    source:           "meta",
    medium:           "facebook_lead_ads",
    sub_source:       formName ?? null,
    meta_lead_id:     metaLeadId,
    meta_form_id:     formId,
    ...attribution,
    ...mapped,
    ...(rawPayload ? { raw_payload: rawPayload } : {}),
    lead_score:       initialScore,
    status:           "NEW",
    stage:            "New",
    lifecycle:        "lead",
    priority:         (mapped as any).priority ?? "Medium",
    last_activity_at: createdAt,
    is_duplicate:     0,
    is_converted:     0,
    is_archived:      0,
    created_by:       username,
    updated_by:       username,
    created_at:       createdAt,
    updated_at:       now,
  }).executeTakeFirst();

  const leadId = insertRes?.insertId != null ? Number(insertRes.insertId) : null;

  // Routing + notification + new_lead automations (best-effort)
  await afterNewMetaLead({
    username,
    leadId,
    name,
    phone,
    formName,
    campaignName: lead.campaign_name ?? null,
    createdAt,
    fireHooks,
  }).catch(() => {});

  return "inserted";
}
