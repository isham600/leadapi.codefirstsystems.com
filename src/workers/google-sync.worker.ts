import { Worker, Job } from "bullmq";
import { sql } from "kysely";
import { db } from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";
import type { GoogleSyncJobData } from "../queues/google-sync.queue.js";

const GOOGLE_ADS_API  = "https://googleads.googleapis.com/v18";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// ── helpers ───────────────────────────────────────────────────

async function refreshToken(refreshTkn: string): Promise<string | null> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshTkn,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    }).toString(),
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  return json.access_token ?? null;
}

function adsHeaders(accessToken: string) {
  return {
    Authorization:     `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type":    "application/json",
  };
}

async function gaqlSearch(
  customerId: string,
  query: string,
  accessToken: string,
): Promise<{ rows: any[]; error: string | null }> {
  const results: any[] = [];
  let pageToken: string | undefined;

  do {
    const body: any = { query };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(
      `${GOOGLE_ADS_API}/customers/${customerId}/googleAds:search`,
      { method: "POST", headers: adsHeaders(accessToken), body: JSON.stringify(body) }
    );
    const json: any = await res.json();
    if (!res.ok) {
      const msg = json?.error?.message ?? "API error";
      return { rows: [], error: msg };
    }
    if (json.results) results.push(...json.results);
    pageToken = json.nextPageToken;
  } while (pageToken);

  return { rows: results, error: null };
}

// ── core sync logic ───────────────────────────────────────────

async function syncForUser(username: string, log: any): Promise<{ newLeads: number; totalSynced: number }> {
  const user: any = await (db as any)
    .selectFrom("users")
    .select(["google_access_token", "google_refresh_token", "google_customer_id"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (!user?.google_access_token) {
    log.warn({ username }, "[googleSync] no access token");
    return { newLeads: 0, totalSynced: 0 };
  }

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) {
    log.warn("[googleSync] GOOGLE_ADS_DEVELOPER_TOKEN not set");
    return { newLeads: 0, totalSynced: 0 };
  }

  let accessToken: string = user.google_access_token;
  let customerIds: string[] = [];

  if (user.google_customer_id) {
    customerIds = [user.google_customer_id];
  } else {
    let custRes = await fetch(`${GOOGLE_ADS_API}/customers:listAccessibleCustomers`, {
      headers: adsHeaders(accessToken),
    });
    if (custRes.status === 401 && user.google_refresh_token) {
      const newToken = await refreshToken(user.google_refresh_token);
      if (newToken) {
        accessToken = newToken;
        await (db as any).updateTable("users")
          .set({ google_access_token: newToken, updated_at: new Date() } as any)
          .where("username", "=", username).execute();
        custRes = await fetch(`${GOOGLE_ADS_API}/customers:listAccessibleCustomers`, {
          headers: adsHeaders(accessToken),
        });
      }
    }
    if (custRes.ok) {
      const custJson: any = await custRes.json();
      customerIds = (custJson.resourceNames ?? []).map((r: string) => r.replace("customers/", ""));
      if (customerIds.length > 0) {
        await (db as any).updateTable("users")
          .set({ google_customer_id: customerIds[0], updated_at: new Date() } as any)
          .where("username", "=", username).execute();
      }
    } else {
      const errText = await custRes.text();
      log.warn({ status: custRes.status, body: errText }, "[googleSync] listAccessibleCustomers failed");
      return { newLeads: 0, totalSynced: 0 };
    }
  }

  if (customerIds.length === 0) return { newLeads: 0, totalSynced: 0 };

  const now = new Date();
  let totalNew = 0, totalSaved = 0;

  for (const customerId of customerIds) {
    try {
      const { rows: acctRows } = await gaqlSearch(customerId,
        `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer`,
        accessToken);
      const acct = acctRows[0]?.customer ?? {};
      const accountName  = acct.descriptiveName ?? acct.descriptive_name ?? `Account ${customerId}`;
      const currencyCode = acct.currencyCode ?? acct.currency_code ?? null;
      const isManager    = acct.manager ? 1 : 0;

      const { rows: formRows, error: formErr } = await gaqlSearch(customerId,
        `SELECT asset.id, asset.name FROM asset WHERE asset.type = 'LEAD_FORM'`,
        accessToken);
      const forms   = formErr ? [] : formRows.map((r: any) => r.asset);
      const formMap: Record<string, string> = {};
      for (const f of forms) {
        if (f?.id) formMap[String(f.id)] = f.name ?? `Form ${f.id}`;
        if (!f?.id) continue;
        await (db as any).insertInto("google_ads_forms")
          .values({ username, customer_id: customerId, account_name: accountName, form_id: String(f.id),
            form_name: f.name ?? null, status: "ACTIVE", lead_count: 0, last_synced_at: now, created_at: now, updated_at: now })
          .onDuplicateKeyUpdate({ form_name: f.name ?? null, account_name: accountName, last_synced_at: now, updated_at: now })
          .execute();
      }

      const { rows: leadRows, error: leadErr } = await gaqlSearch(customerId,
        `SELECT lead_form_submission_data.id, lead_form_submission_data.asset,
         lead_form_submission_data.gclid, lead_form_submission_data.submission_date_time,
         lead_form_submission_data.lead_form_submission_fields
         FROM lead_form_submission_data
         ORDER BY lead_form_submission_data.submission_date_time DESC`,
        accessToken);
      const leads = leadErr ? [] : leadRows.map((r: any) => r.leadFormSubmissionData ?? r.lead_form_submission_data);
      const formLeadCount: Record<string, number> = {};

      for (const lead of leads) {
        if (!lead) continue;
        const assetResource: string = lead.asset ?? "";
        const formId   = assetResource.split("/assets/")?.[1] ?? null;
        const formName = formId ? (formMap[formId] ?? null) : null;
        const fields: any[] = lead.leadFormSubmissionFields ?? lead.lead_form_submission_fields ?? [];
        let firstName: string | null = null, lastName: string | null = null;
        let email: string | null = null, phone: string | null = null;
        for (const field of fields) {
          const col = field.columnId ?? field.column_id ?? "";
          const val = field.stringValue ?? field.string_value ?? "";
          if (col === "FULL_NAME") { const p = val.trim().split(" "); firstName = p[0] ?? null; lastName = p.slice(1).join(" ") || null; }
          else if (col === "FIRST_NAME")   firstName = val || null;
          else if (col === "LAST_NAME")    lastName  = val || null;
          else if (col === "EMAIL")        email     = val || null;
          else if (col === "PHONE_NUMBER") phone     = val || null;
        }
        const submittedAt = (lead.submissionDateTime ?? lead.submission_date_time)
          ? new Date(lead.submissionDateTime ?? lead.submission_date_time) : now;
        const submissionId = String(lead.id ?? "");
        if (!submissionId) continue;

        const isNew = await (db as any).insertInto("google_ads_leads")
          .values({ username, customer_id: customerId, account_name: accountName, form_id: formId,
            form_name: formName, submission_id: submissionId, first_name: firstName, last_name: lastName,
            email, phone, utm_source: "google", utm_campaign: null, gclid: lead.gclid ?? null,
            submitted_at: submittedAt, created_at: now, updated_at: now })
          .onDuplicateKeyUpdate({ updated_at: now })
          .execute()
          .then((r: any) => r.numInsertedOrUpdatedRows > 0n)
          .catch(() => false);

        if (isNew) totalNew++;
        totalSaved++;
        if (formId) formLeadCount[formId] = (formLeadCount[formId] ?? 0) + 1;
      }

      for (const [fId, count] of Object.entries(formLeadCount)) {
        await (db as any).updateTable("google_ads_forms")
          .set({ lead_count: count, updated_at: now })
          .where("username", "=", username).where("customer_id", "=", customerId).where("form_id", "=", fId)
          .execute();
      }

      await (db as any).insertInto("google_ads_accounts")
        .values({ username, customer_id: customerId, account_name: accountName, currency_code: currencyCode,
          is_manager_account: isManager, status: "ACTIVE", lead_count: leads.length,
          lead_form_count: forms.length, last_synced_at: now, created_at: now, updated_at: now })
        .onDuplicateKeyUpdate({ account_name: accountName, currency_code: currencyCode,
          is_manager_account: isManager, lead_count: leads.length, lead_form_count: forms.length,
          last_synced_at: now, updated_at: now })
        .execute();
    } catch (err) {
      log.error({ err, customerId }, "[googleSync] error processing customer");
    }
  }

  return { newLeads: totalNew, totalSynced: totalSaved };
}

// ── worker ────────────────────────────────────────────────────

async function processJob(job: Job<GoogleSyncJobData>) {
  const { username } = job.data;
  const result = await syncForUser(username, console);
  console.log(`[googleSync] done — username: ${username}`, result);
  return result;
}

export function startGoogleSyncWorker() {
  const worker = new Worker<GoogleSyncJobData>("google-ads-sync", processJob, {
    connection: redisConnection as any,
    concurrency: 2,
  });

  worker.on("completed", (job, result) => {
    console.log(`[googleSync] job ${job.id} completed —`, result);
  });

  worker.on("failed", (job, err) => {
    console.error(`[googleSync] job ${job?.id} failed: ${err.message}`);
  });

  console.log("[googleSync] worker started — concurrency: 2");
  return worker;
}
