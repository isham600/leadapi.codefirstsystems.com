import { db } from "../../../models/db.js";

/**
 * ============================================================
 * 🧠 LEAD SERVICE (COMMON FOR ALL SOURCES)
 * ------------------------------------------------------------
 * Used by:
 * - Google Ads
 * - Facebook / Instagram Webhooks
 * - WhatsApp Webhooks
 * - Website Forms
 * ============================================================
 */

type NormalizedLead = {
  // user provided
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;

  // source info
  source: string;                 // google | facebook | whatsapp | instagram
  medium?: string | null;
  campaign?: string | null;
  term?: string | null;
  content?: string | null;
  gclid?: string | null;
  landing_page?: string | null;

  // owner resolution
  owner_key: string | null;
};

export const leadService = {
  /**
   * ============================================================
   * 🎯 CAPTURE LEAD (ENTRY METHOD)
   * ============================================================
   */
  async captureLead(data: NormalizedLead) {
    // ----------------------------------------------------------
    // 1️⃣ RESOLVE OWNER (tenant + username)
    // ----------------------------------------------------------
    const owner = await resolveOwner(data.owner_key);

    // ----------------------------------------------------------
    // 2️⃣ DUPLICATE CHECK (TENANT SCOPED)
    // ----------------------------------------------------------
    const duplicateLead = await checkDuplicateLead({
      tenant_id: owner.tenant_id,
      phone: data.phone,
      email: data.email,
      gclid: data.gclid,
    });

    if (duplicateLead) {
      // 🔁 log duplicate activity
      await insertActivity({
        tenant_id: owner.tenant_id,
        lead_id: duplicateLead.id,
        lead_name: duplicateLead.full_name || `${data.first_name} ${data.last_name || ""}`.trim(),
        source: data.source,
        action: "DUPLICATE_SUBMISSION",
        description: "Duplicate lead detected",
        metadata: {
          phone: data.phone,
          email: data.email,
          gclid: data.gclid,
        },
      });

      return {
        status: 1,
        statuscode: 200,
        message: "Duplicate lead detected",
        data: {
          lead_id: duplicateLead.id,
          duplicate: true,
        },
      };
    }

    // ----------------------------------------------------------
    // 3️⃣ INSERT LEAD
    // ----------------------------------------------------------
    const insertResult = await db
      .insertInto("leads")
      .values({
        tenant_id: owner.tenant_id,
        username: owner.username, // 🔥 OWNER USERNAME

        first_name: data.first_name,
        last_name: data.last_name || null,
        full_name: `${data.first_name} ${data.last_name || ""}`.trim(),

        email: data.email || null,
        phone: data.phone || null,

        source: data.source,
        medium: data.medium || null,
        campaign: data.campaign || null,
        term: data.term || null,
        content: data.content || null,
        gclid: data.gclid || null,
        landing_page: data.landing_page || null,

        status: "NEW",
        lifecycle: "lead",

        created_at: new Date(),
        updated_at: new Date(),
      })
      .executeTakeFirst();

    const leadId = Number(insertResult.insertId);

    // ----------------------------------------------------------
    // 4️⃣ LEAD HISTORY
    // ----------------------------------------------------------
    await insertHistory({
      tenant_id: owner.tenant_id,
      lead_id: leadId,
      field_name: "source",
      old_value: null,
      new_value: data.source,
      description: `Lead captured via ${data.source}`,
    });

    // ----------------------------------------------------------
    // 5️⃣ ACTIVITY LOG
    // ----------------------------------------------------------
    await insertActivity({
      tenant_id: owner.tenant_id,
      lead_id: leadId,
      lead_name: `${data.first_name} ${data.last_name || ""}`.trim(),
      source: data.source,
      action: "LEAD_CREATED",
      description: "Lead created successfully",
      metadata: {
        campaign: data.campaign,
        gclid: data.gclid,
        landing_page: data.landing_page,
      },
    });

    // ----------------------------------------------------------
    // ✅ RESPONSE
    // ----------------------------------------------------------
    return {
      status: 1,
      statuscode: 201,
      message: "Lead captured successfully",
      data: {
        lead_id: leadId,
        duplicate: false,
      },
    };
  },
};

/**
 * ============================================================
 * 🔐 RESOLVE OWNER (owner_key → user → tenant)
 * ============================================================
 */
async function resolveOwner(owner_key: string | null) {
  if (!owner_key) {
    throw new Error("Owner key missing");
  }

  const owner = await db
    .selectFrom("users")
    .select(["username", "tenant_id"])
    .where("owner_key", "=", owner_key)
    .executeTakeFirst();

  if (!owner) {
    throw new Error("Invalid owner key");
  }

  return owner;
}

/**
 * ============================================================
 * 🔁 DUPLICATE CHECK
 * ============================================================
 */
async function checkDuplicateLead(params: {
  tenant_id: string;
  phone?: string | null;
  email?: string | null;
  gclid?: string | null;
}) {
  const { tenant_id, phone, email, gclid } = params;

  return await db
    .selectFrom("leads")
    .select(["id", "full_name"])
    .where("tenant_id", "=", tenant_id)
    .where((eb) =>
      eb.or([
        phone ? eb("phone", "=", phone) : eb.lit(false),
        email ? eb("email", "=", email) : eb.lit(false),
        gclid ? eb("gclid", "=", gclid) : eb.lit(false),
      ])
    )
    .executeTakeFirst();
}

/**
 * ============================================================
 * 🕘 INSERT HISTORY
 * ============================================================
 */
async function insertHistory(params: {
  tenant_id: string;
  lead_id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  description: string;
}) {
  await db.insertInto("lead_history").values({
    tenant_id: params.tenant_id,
    lead_id: params.lead_id,
    field_name: params.field_name,
    old_value: params.old_value,
    new_value: params.new_value,
    description: params.description,
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();
}

/**
 * ============================================================
 * 📞 INSERT ACTIVITY
 * ============================================================
 */
async function insertActivity(params: {
  tenant_id: string;
  lead_id: number;
  lead_name: string;
  source: string;
  action: string;
  description: string;
  metadata?: any;
}) {
  await db.insertInto("lead_activities").values({
    tenant_id: params.tenant_id,
    lead_id: params.lead_id,
    lead_name: params.lead_name,
    activity_type: "FORM",
    action: params.action,
    status: "submitted",
    source: params.source,
    description: params.description,
    metadata: params.metadata
      ? JSON.stringify(params.metadata)
      : null,
    created_at: new Date(),
  }).execute();
}
