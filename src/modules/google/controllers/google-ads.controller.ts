import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { googleSyncQueue } from "../../../queues/google-sync.queue.js";

async function resolveAccountUsername(req: FastifyRequest): Promise<string | null> {
  const username = (req as any).user?.username ?? null;
  if (!username) return null;
  const userType = (req as any).user?.user_type as number | undefined;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    return parentRow?.parent_username ?? username;
  }
  return username;
}

// ── types ─────────────────────────────────────────────────────
export type GoogleLeadsQuery = {
  page?:   string;
  limit?:  string;
  search?: string;
};

// ============================================================
// 0. DELETE /google/disconnect
// ============================================================
export const disconnectGoogle = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  await Promise.all([
    // Clear tokens from users table
    (db as any)
      .updateTable("users")
      .set({
        google_access_token:  null,
        google_refresh_token: null,
        google_customer_id:   null,
        updated_at:           new Date(),
      } as any)
      .where("username", "=", username)
      .execute(),

    // Delete synced data
    (db as any).deleteFrom("google_ads_accounts").where("username", "=", username).execute(),
    (db as any).deleteFrom("google_ads_forms").where("username", "=", username).execute(),
    (db as any).deleteFrom("google_ads_leads").where("username", "=", username).execute(),
  ]);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Google Ads disconnected successfully",
    data: null,
  });
};

// ============================================================
// 1. GET /google/connection
// ============================================================
export const getGoogleConnection = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  const user: any = await (db as any)
    .selectFrom("users")
    .select(["google_access_token", "google_customer_id", "updated_at"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (!user?.google_access_token) {
    return reply.send({ status: 0, statuscode: 200, message: "Google Ads not connected", data: null });
  }

  // Aggregate totals from synced tables
  const [acctRow, leadsRow, formsRow, lastSyncRow] = await Promise.all([
    (db as any).selectFrom("google_ads_accounts")
      .select((eb: any) => eb.fn.countAll().as("total"))
      .where("username", "=", username).executeTakeFirst(),

    (db as any).selectFrom("google_ads_leads")
      .select((eb: any) => eb.fn.countAll().as("total"))
      .where("username", "=", username).executeTakeFirst(),

    (db as any).selectFrom("google_ads_forms")
      .select((eb: any) => eb.fn.countAll().as("total"))
      .where("username", "=", username).executeTakeFirst(),

    (db as any).selectFrom("google_ads_accounts")
      .select(["last_synced_at"])
      .where("username", "=", username)
      .orderBy("last_synced_at", "desc")
      .executeTakeFirst(),
  ]);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Google Ads connection fetched",
    data: {
      status:         "active",
      connectedAt:    user.updated_at ?? null,
      lastSyncedAt:   lastSyncRow?.last_synced_at ?? null,
      totalAccounts:  parseInt(String(acctRow?.total ?? 0), 10),
      totalLeads:     parseInt(String(leadsRow?.total ?? 0), 10),
      totalForms:     parseInt(String(formsRow?.total ?? 0), 10),
    },
  });
};

// ============================================================
// 2. GET /google/accounts
// ============================================================
export const getGoogleAccounts = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  const accounts: any[] = await (db as any)
    .selectFrom("google_ads_accounts")
    .selectAll()
    .where("username", "=", username)
    .orderBy("created_at", "desc")
    .execute();

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Ad accounts fetched",
    data: accounts.map((a) => ({
      id:               a.id,
      customerId:       a.customer_id,
      accountName:      a.account_name,
      currencyCode:     a.currency_code,
      isManagerAccount: a.is_manager_account === 1,
      status:           a.status,
      leadCount:        a.lead_count,
      leadFormCount:    a.lead_form_count,
      lastSyncedAt:     a.last_synced_at,
    })),
  });
};

// ============================================================
// 3. GET /google/forms
// ============================================================
export const getGoogleForms = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  const forms: any[] = await (db as any)
    .selectFrom("google_ads_forms")
    .selectAll()
    .where("username", "=", username)
    .orderBy("created_at", "desc")
    .execute();

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Lead forms fetched",
    data: forms.map((f) => ({
      id:          f.id,
      formId:      f.form_id,
      formName:    f.form_name,
      customerId:  f.customer_id,
      accountName: f.account_name,
      status:      f.status,
      leadCount:   f.lead_count,
      createdAt:   f.created_at,
    })),
  });
};

// ============================================================
// 4. GET /google/leads
// ============================================================
export const getGoogleLeads = async (
  req: FastifyRequest<{ Querystring: GoogleLeadsQuery }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  const { page = "1", limit = "20", search } = req.query;
  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset   = (pageNum - 1) * limitNum;

  let query = (db as any)
    .selectFrom("google_ads_leads")
    .where("username", "=", username);

  let countQuery = (db as any)
    .selectFrom("google_ads_leads")
    .where("username", "=", username);

  if (search) {
    const like = `%${search}%`;
    query = query.where((eb: any) =>
      eb.or([
        eb("first_name", "like", like),
        eb("last_name",  "like", like),
        eb("email",      "like", like),
        eb("phone",      "like", like),
      ])
    );
    countQuery = countQuery.where((eb: any) =>
      eb.or([
        eb("first_name", "like", like),
        eb("last_name",  "like", like),
        eb("email",      "like", like),
        eb("phone",      "like", like),
      ])
    );
  }

  const [leads, [{ total }]] = await Promise.all([
    query
      .selectAll()
      .orderBy("submitted_at", "desc")
      .limit(limitNum)
      .offset(offset)
      .execute(),

    countQuery
      .select((eb: any) => eb.fn.countAll().as("total"))
      .execute(),
  ]);

  const totalCount = parseInt(String(total), 10);
  const totalPages = Math.ceil(totalCount / limitNum);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Leads fetched",
    data: leads.map((l: any) => ({
      id:          l.id,
      formName:    l.form_name,
      accountName: l.account_name,
      firstName:   l.first_name,
      lastName:    l.last_name,
      email:       l.email,
      phone:       l.phone,
      utmSource:   l.utm_source,
      utmCampaign: l.utm_campaign,
      gclid:       l.gclid,
      createdAt:   l.submitted_at,
    })),
    meta: {
      total:      totalCount,
      page:       pageNum,
      limit:      limitNum,
      totalPages,
      hasNext:    pageNum < totalPages,
      hasPrev:    pageNum > 1,
    },
  });
};

// ============================================================
// 5. POST /google/leads/sync
// ============================================================
export const syncGoogleLeads = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  await googleSyncQueue.add(`sync-${username}-${Date.now()}` as any, { username }, { priority: 1 });

  return reply.status(202).send({
    status: 1,
    statuscode: 202,
    message: "Sync queued — processing in background worker",
    data: null,
  });
};
