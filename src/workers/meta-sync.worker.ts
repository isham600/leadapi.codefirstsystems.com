import { Worker, Job } from "bullmq";
import { db } from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";
import type { MetaSyncJobData } from "../queues/meta-sync.queue.js";
import {
  upsertMetaLead,
  resolveTenantId,
  LEAD_FIELDS_FULL,
  LEAD_FIELDS_BASIC,
} from "../modules/meta/services/meta-lead.service.js";

const META_GRAPH = "https://graph.facebook.com/v25.0";

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
  // Try FULL fields (incl. campaign/adset/ad attribution) first; if the token
  // lacks ads_read Meta rejects the whole call, so retry with BASIC fields
  for (const fields of [LEAD_FIELDS_FULL, LEAD_FIELDS_BASIC]) {
    const all: any[] = [];
    let errored = false;
    let url: string = `${META_GRAPH}/${formId}/leads?fields=${fields}&limit=100&access_token=${pageToken}`;
    while (url) {
      const res  = await fetch(url);
      const json: any = await res.json();
      if (json.error) {
        console.error(`[metaSync] leads error for form ${formId} (fields=${fields === LEAD_FIELDS_FULL ? "full" : "basic"}):`, json.error.message);
        errored = true;
        break;
      }
      all.push(...(json.data ?? []));
      url = json.paging?.next ?? "";
    }
    if (!errored) return all;
  }
  return [];
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

const ALLOWED_DATE_PRESETS = new Set(["today", "yesterday", "last_7d", "last_14d", "last_30d", "last_90d", "this_month", "last_month", "maximum"]);

async function fetchCampaignInsights(adAccountId: string, accessToken: string, datePreset = "last_30d"): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const preset = ALLOWED_DATE_PRESETS.has(datePreset) ? datePreset : "last_30d";
  try {
    const url = `${META_GRAPH}/act_${adAccountId}/insights?fields=campaign_id,spend,impressions,clicks,reach,actions&date_preset=${preset}&level=campaign&limit=100&access_token=${accessToken}`;
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
// Lead manager sync — delegates to the shared meta-lead service so the
// webhook and this worker produce identical lead records
// ─────────────────────────────────────────────────────────────────────────────

async function syncFormLeadsToLeadManager(
  username:  string,
  tenantId:  string,
  formId:    string,
  formName:  string,
  leads:     any[],
): Promise<number> {
  let synced = 0;
  for (const lead of leads) {
    try {
      const result = await upsertMetaLead({ username, tenantId, formId, formName, lead });
      if (result !== "skipped") synced++;
    } catch (err: any) {
      console.error(`[metaSync] lead ${lead.id} upsert error: ${err.message}`);
    }
  }
  return synced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token health refresh — merged into the profile cache on every auto tick
// ─────────────────────────────────────────────────────────────────────────────

async function refreshTokenHealth(acct: any): Promise<void> {
  const appId     = acct.app_id     ?? process.env.META_APP_ID;
  const appSecret = acct.app_secret ?? process.env.META_APP_SECRET;
  if (!appId || !appSecret || !acct.access_token) return;

  const res = await fetch(
    `${META_GRAPH}/debug_token?input_token=${encodeURIComponent(acct.access_token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`
  );
  const json: any = await res.json();
  const d = json?.data;
  if (!d) return;

  const expiresAt = d.expires_at ? new Date(d.expires_at * 1000) : null;
  const tokenHealth = {
    is_valid:   !!d.is_valid,
    expires_at: expiresAt,
    days_left:  expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000) : null,
    scopes:     d.scopes ?? [],
    type:       d.type ?? null,
  };

  let cache: Record<string, any> = {};
  try { cache = acct.profile_cache ? JSON.parse(acct.profile_cache) : {}; } catch { cache = {}; }
  cache.token_health = tokenHealth;

  await (db as any)
    .updateTable("meta_accounts")
    .set({ profile_cache: JSON.stringify(cache) })
    .where("id", "=", acct.id)
    .execute();
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

async function processJob(job: Job<MetaSyncJobData>): Promise<{ forms: number; campaigns: number; leads: number }> {
  const { username, pageId, adAccountId, accessToken, syncType, datePreset } = job.data;
  console.log(`[metaSync] processing ${username} syncType=${syncType}`, { pageId, adAccountId, datePreset });

  // ── AUTO tick: fan out one cache-sync job per active Meta account ────────
  if (syncType === "auto") {
    const accounts: any[] = await (db as any)
      .selectFrom("meta_accounts")
      .select(["id", "username", "page_id", "ad_account_id", "access_token", "app_id", "app_secret", "profile_cache"])
      .where("status", "=", "active")
      .execute();

    const { metaSyncQueue } = await import("../queues/meta-sync.queue.js");
    for (const acct of accounts) {
      if (!acct.page_id || !acct.access_token) continue;
      await metaSyncQueue.add(
        `meta-auto-cache-${acct.username}-${Date.now()}`,
        {
          username: acct.username, accountId: acct.id, pageId: acct.page_id,
          adAccountId: acct.ad_account_id ?? null, accessToken: acct.access_token,
          syncType: "cache",
        },
        { priority: 5 } // lower priority than user-triggered syncs
      );

      // Token health is the one profile field that must stay live — refresh it
      // into the profile cache every tick so an expired token surfaces within
      // 30 min instead of hiding behind the 24h profile TTL
      await refreshTokenHealth(acct).catch(() => {});
    }
    console.log(`[metaSync] auto tick — queued cache sync for ${accounts.length} account(s)`);
    return { forms: 0, campaigns: 0, leads: 0 };
  }

  const pageToken = await getPageToken(accessToken, pageId);
  let formCount = 0, campaignCount = 0, totalLeads = 0;

  // ── CACHE sync: lead forms list + campaigns ──────────────
  if (syncType === "cache" || syncType === "all") {
    const forms = await fetchAllLeadForms(pageId, pageToken);
    console.log(`[metaSync] fetched ${forms.length} lead forms for ${username}`);
    await upsertLeadForms(username, pageId, forms);
    formCount = forms.length;

    if (adAccountId) {
      // Ad-account endpoints need the user token (ads_read) — page tokens
      // cannot read act_<id>/campaigns or /insights
      const [campaigns, insights] = await Promise.all([
        fetchAllCampaigns(adAccountId, accessToken),
        fetchCampaignInsights(adAccountId, accessToken, datePreset),
      ]);
      console.log(`[metaSync] fetched ${campaigns.length} campaigns for ${username}`);
      await upsertCampaigns(username, adAccountId, campaigns, insights);
      campaignCount = campaigns.length;
    }
  }

  // ── LEADS sync: fetch all form leads → lead manager ──────
  if (syncType === "leads" || syncType === "all") {
    const tenantId = await resolveTenantId(username);

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

const AUTO_SYNC_EVERY_MS = 30 * 60 * 1000; // 30 minutes

export function startMetaSyncWorker() {
  const worker = new Worker<MetaSyncJobData>(
    "meta-sync",
    processJob,
    { connection: redisConnection as any, concurrency: 3 }
  );

  // Scheduled auto-sync: repeatable job keeps forms/campaign caches fresh
  // without anyone clicking "Sync from Meta" (jobId dedupes registration)
  import("../queues/meta-sync.queue.js").then(({ metaSyncQueue }) =>
    metaSyncQueue.add(
      "meta-auto-sync",
      { username: "*", accountId: 0, pageId: "*", adAccountId: null, accessToken: "", syncType: "auto" },
      { repeat: { every: AUTO_SYNC_EVERY_MS }, jobId: "meta-auto-sync" }
    )
  ).then(() => {
    console.log(`[metaSync] auto-sync scheduled every ${AUTO_SYNC_EVERY_MS / 60000} min`);
  }).catch((err) => {
    console.error("[metaSync] failed to schedule auto-sync:", err?.message);
  });

  worker.on("completed", (job, result) => {
    console.log(`[metaSync] job ${job.id} done — forms: ${result.forms}, campaigns: ${result.campaigns}, leads synced: ${result.leads}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[metaSync] job ${job?.id} failed: ${err.message}`);
  });

  console.log("[metaSync] worker started — concurrency: 3");
  return worker;
}
