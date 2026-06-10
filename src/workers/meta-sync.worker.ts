import { Worker, Job } from "bullmq";
import { db } from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";
import type { MetaSyncJobData } from "../queues/meta-sync.queue.js";

const META_GRAPH = "https://graph.facebook.com/v25.0";

// ─────────────────────────────────────────────────────────────────────────────
// Field helpers (same logic as lead-dispatcher + webhook handler)
// ─────────────────────────────────────────────────────────────────────────────

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const cleaned = raw.trim().replace(/^\+/, "").replace(/[\s\-().]/g, "");
  // Only keep if it looks like a phone number (digits only, 5–20 chars)
  if (!/^\d{5,20}$/.test(cleaned)) return null;
  return cleaned;
}

function splitName(name: string | null | undefined) {
  if (!name?.trim()) return { first: "Unknown", last: null, full: null };
  const parts = name.trim().split(/\s+/);
  return {
    first: parts[0],
    last:  parts.length > 1 ? parts.slice(1).join(" ") : null,
    full:  name.trim(),
  };
}

function parseFieldData(fieldData: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldData ?? []) {
    if (f.name) out[f.name.toLowerCase()] = f.values?.[0] ?? "";
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta Graph API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getPageToken(userToken: string, pageId: string): Promise<string> {
  try {
    const res  = await fetch(`${META_GRAPH}/${pageId}?fields=access_token&access_token=${userToken}`);
    const json: any = await res.json();
    return json.access_token ?? userToken;
  } catch {
    return userToken;
  }
}

async function fetchAllLeadForms(pageId: string, pageToken: string): Promise<any[]> {
  const all: any[] = [];
  let url: string = `${META_GRAPH}/${pageId}/leadgen_forms?fields=id,name,status,leads_count,created_time&limit=100&access_token=${pageToken}`;
  while (url) {
    const res  = await fetch(url);
    const json: any = await res.json();
    if (json.error) { console.error("[metaSync] leadgen_forms error", json.error.message); break; }
    all.push(...(json.data ?? []));
    url = json.paging?.next ?? "";
  }
  return all;
}

async function fetchAllFormLeads(formId: string, pageToken: string): Promise<any[]> {
  const all: any[] = [];
  let url: string = `${META_GRAPH}/${formId}/leads?fields=id,created_time,field_data&limit=100&access_token=${pageToken}`;
  while (url) {
    const res  = await fetch(url);
    const json: any = await res.json();
    if (json.error) { console.error(`[metaSync] leads error for form ${formId}:`, json.error.message); break; }
    all.push(...(json.data ?? []));
    url = json.paging?.next ?? "";
  }
  return all;
}

async function fetchAllCampaigns(adAccountId: string, accessToken: string): Promise<any[]> {
  const all: any[] = [];
  let url: string = `${META_GRAPH}/act_${adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time&limit=100&access_token=${accessToken}`;
  while (url) {
    const res  = await fetch(url);
    const json: any = await res.json();
    if (json.error) { console.error("[metaSync] campaigns error", json.error.message); break; }
    all.push(...(json.data ?? []));
    url = json.paging?.next ?? "";
  }
  return all;
}

async function fetchCampaignInsights(adAccountId: string, accessToken: string): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  try {
    const url = `${META_GRAPH}/act_${adAccountId}/insights?fields=campaign_id,spend,impressions,clicks,reach,actions&date_preset=last_30d&level=campaign&limit=100&access_token=${accessToken}`;
    const res  = await fetch(url);
    const json: any = await res.json();
    for (const row of json.data ?? []) {
      const leads = (row.actions ?? []).find((a: any) => a.action_type === "lead")?.value ?? null;
      map.set(row.campaign_id, {
        spend:       row.spend       ? parseFloat(row.spend)       : null,
        impressions: row.impressions ? parseInt(row.impressions)   : null,
        clicks:      row.clicks      ? parseInt(row.clicks)        : null,
        reach:       row.reach       ? parseInt(row.reach)         : null,
        leads:       leads           ? parseInt(leads)             : null,
      });
    }
  } catch (err: any) {
    console.error("[metaSync] insights fetch error", err.message);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache upsert helpers
// ─────────────────────────────────────────────────────────────────────────────

async function upsertLeadForms(username: string, pageId: string, forms: any[]) {
  const now = new Date();
  for (const f of forms) {
    const row = {
      username,
      page_id:      pageId,
      form_id:      String(f.id),
      name:         f.name ?? "",
      status:       f.status ?? "ACTIVE",
      leads_count:  f.leads_count ?? 0,
      created_time: f.created_time ? new Date(f.created_time) : null,
      synced_at:    now,
    };
    const { synced_at, ...updateFields } = row;
    await (db as any)
      .insertInto("meta_lead_forms_cache")
      .values({ ...row })
      .onDuplicateKeyUpdate({ ...updateFields, synced_at: now })
      .execute();
  }
}

async function upsertCampaigns(username: string, adAccountId: string, campaigns: any[], insights: Map<string, any>) {
  const now = new Date();
  for (const c of campaigns) {
    const ins = insights.get(String(c.id)) ?? {};
    const row = {
      username,
      ad_account_id:   adAccountId,
      campaign_id:     String(c.id),
      name:            c.name ?? "",
      status:          c.status ?? "ACTIVE",
      objective:       c.objective ?? null,
      daily_budget:    c.daily_budget    ? BigInt(c.daily_budget)    : null,
      lifetime_budget: c.lifetime_budget ? BigInt(c.lifetime_budget) : null,
      start_time:      c.start_time  ? new Date(c.start_time)  : null,
      stop_time:       c.stop_time   ? new Date(c.stop_time)   : null,
      spend:           ins.spend       ?? null,
      impressions:     ins.impressions ?? null,
      clicks:          ins.clicks      ?? null,
      reach:           ins.reach       ?? null,
      leads:           ins.leads       ?? null,
      created_time:    c.created_time ? new Date(c.created_time) : null,
      synced_at:       now,
    };
    const { synced_at, ...updateFields } = row;
    await (db as any)
      .insertInto("meta_campaigns_cache")
      .values({ ...row })
      .onDuplicateKeyUpdate({ ...updateFields, synced_at: now })
      .execute();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead manager sync — same dedup logic as lead-dispatcher + webhook
// ─────────────────────────────────────────────────────────────────────────────

const SCORE = { INITIAL: 10, HAS_NAME: 2, HAS_PHONE: 3, HAS_EMAIL: 5, INBOUND_MESSAGE: 2 } as const;

async function syncFormLeadsToLeadManager(
  username:  string,
  tenantId:  string,
  formId:    string,
  formName:  string,
  leads:     any[],
): Promise<number> {
  let synced = 0;
  const now  = new Date();

  for (const lead of leads) {
    try {
      const metaLeadId = String(lead.id);
      const fields     = parseFieldData(lead.field_data ?? []);
      const phone      = normalizePhone(fields["phone_number"] || fields["phone"]);
      const email      = (fields["email"] || "").trim() || null;
      const name       = fields["full_name"] || fields["name"] || null;
      const createdAt  = lead.created_time ? new Date(lead.created_time) : now;

      if (!phone && !email) continue;

      // ── 1. Primary dedup: meta_lead_id (already synced from a previous run or webhook)
      const byMetaId: any = await (db as any)
        .selectFrom("leads")
        .select(["id", "email", "full_name", "phone"])
        .where("username",     "=", username)
        .where("meta_lead_id", "=", metaLeadId)
        .executeTakeFirst();

      if (byMetaId) {
        // Already synced — enrich missing fields only, no score bump
        const enrichment: Record<string, any> = { updated_at: now };
        if (name && (!byMetaId.full_name || byMetaId.full_name === "Unknown")) {
          const n = splitName(name);
          enrichment.first_name = n.first;
          enrichment.last_name  = n.last;
          enrichment.full_name  = n.full;
        }
        if (email && !byMetaId.email) enrichment.email = email;
        if (phone && !byMetaId.phone) enrichment.phone = phone;
        if (Object.keys(enrichment).length > 1) {
          await (db as any).updateTable("leads").set(enrichment).where("id", "=", byMetaId.id).execute();
        }
        synced++; // count as processed
        continue;
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
          // Tag with meta IDs if not already set
          ...(!existing.meta_lead_id ? { meta_lead_id: metaLeadId, meta_form_id: formId, medium: "facebook_lead_ads" } : {}),
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
        synced++; // count updated leads too

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
            sub_source:       formName,
            meta_lead_id:     metaLeadId,
            meta_form_id:     formId,
            lead_score:       dupScore,
            status:           "NEW",
            lifecycle:        "lead",
            priority:         "Medium",
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

      } else {
        // ── INSERT new lead ──────────────────────────────────
        const { first, last, full } = splitName(name);
        let initialScore = SCORE.INITIAL;
        if (name)  initialScore += SCORE.HAS_NAME;
        if (phone) initialScore += SCORE.HAS_PHONE;
        if (email) initialScore += SCORE.HAS_EMAIL;

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
          sub_source:       formName,
          meta_lead_id:     metaLeadId,
          meta_form_id:     formId,
          lead_score:       initialScore,
          status:           "NEW",
          stage:            "New",
          lifecycle:        "lead",
          priority:         "Medium",
          last_activity_at: createdAt,
          is_duplicate:     0,
          is_converted:     0,
          is_archived:      0,
          created_by:       username,
          updated_by:       username,
          created_at:       createdAt,
          updated_at:       now,
        }).execute();
      }

      synced++;
    } catch (err: any) {
      console.error(`[metaSync] lead ${lead.id} upsert error: ${err.message}`);
    }
  }

  return synced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

async function processJob(job: Job<MetaSyncJobData>): Promise<{ forms: number; campaigns: number; leads: number }> {
  const { username, pageId, adAccountId, accessToken, syncType } = job.data;
  console.log(`[metaSync] processing ${username} syncType=${syncType}`, { pageId, adAccountId });

  const pageToken = await getPageToken(accessToken, pageId);
  let formCount = 0, campaignCount = 0, totalLeads = 0;

  // ── CACHE sync: lead forms list + campaigns ──────────────
  if (syncType === "cache" || syncType === "all") {
    const forms = await fetchAllLeadForms(pageId, pageToken);
    console.log(`[metaSync] fetched ${forms.length} lead forms for ${username}`);
    await upsertLeadForms(username, pageId, forms);
    formCount = forms.length;

    if (adAccountId) {
      const [campaigns, insights] = await Promise.all([
        fetchAllCampaigns(adAccountId, pageToken),
        fetchCampaignInsights(adAccountId, pageToken),
      ]);
      console.log(`[metaSync] fetched ${campaigns.length} campaigns for ${username}`);
      await upsertCampaigns(username, adAccountId, campaigns, insights);
      campaignCount = campaigns.length;
    }
  }

  // ── LEADS sync: fetch all form leads → lead manager ──────
  if (syncType === "leads" || syncType === "all") {
    const userRow: any = await (db as any)
      .selectFrom("users")
      .select(["uuid"])
      .where("username", "=", username)
      .executeTakeFirst();
    const tenantId = userRow?.uuid ?? username;

    // Get forms from cache (fast) or fetch live if cache sync wasn't part of this job
    let forms: any[];
    if (syncType === "leads") {
      forms = await fetchAllLeadForms(pageId, pageToken);
    } else {
      forms = await (db as any)
        .selectFrom("meta_lead_forms_cache")
        .select(["form_id as id", "name"])
        .where("username", "=", username)
        .execute();
    }

    for (const form of forms) {
      try {
        const formLeads = await fetchAllFormLeads(String(form.id), pageToken);
        console.log(`[metaSync] form ${form.id} (${form.name}): ${formLeads.length} leads`);
        const synced = await syncFormLeadsToLeadManager(username, tenantId, String(form.id), form.name ?? "", formLeads);
        totalLeads += synced;
      } catch (err: any) {
        console.error(`[metaSync] form ${form.id} lead sync error: ${err.message}`);
      }
    }
  }

  return { forms: formCount, campaigns: campaignCount, leads: totalLeads };
}

// ─────────────────────────────────────────────────────────────────────────────
// Export starter
// ─────────────────────────────────────────────────────────────────────────────

export function startMetaSyncWorker() {
  const worker = new Worker<MetaSyncJobData>(
    "meta-sync",
    processJob,
    { connection: redisConnection as any, concurrency: 3 }
  );

  worker.on("completed", (job, result) => {
    console.log(`[metaSync] job ${job.id} done — forms: ${result.forms}, campaigns: ${result.campaigns}, leads synced: ${result.leads}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[metaSync] job ${job?.id} failed: ${err.message}`);
  });

  console.log("[metaSync] worker started — concurrency: 3");
  return worker;
}
