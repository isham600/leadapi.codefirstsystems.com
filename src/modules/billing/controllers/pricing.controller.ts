import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import {
  validateRatesAgainstParent,
  getProfile,
  PricingProfileInput,
} from "../services/pricing.service.js";

// ── GET /billing/pricing ────────────────────────────────────────
export const getPricingProfiles = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const username = (req as any).user?.username;
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const profiles = await (db as any)
    .selectFrom("pricing_profiles")
    .selectAll()
    .where("username", "=", username)
    .where("is_active", "=", 1)
    .orderBy("channel", "asc")
    .execute();

  return reply.send({ status: 1, statuscode: 200, message: "Profiles fetched", data: profiles });
};

// ── GET /billing/pricing/:channel/:category ──────────────────────
export const getSingleProfile = async (
  req: FastifyRequest<{ Params: { channel: string; category: string }; Querystring: { target_username?: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const callerUsername = (req as any).user?.username;
  if (!callerUsername) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  // Allow admin/parent to view another user's profile via ?target_username=
  const username = req.query.target_username ?? callerUsername;
  const { channel, category } = req.params;
  const profile = await getProfile(username, channel, category);

  if (!profile) return reply.status(404).send({ status: 0, statuscode: 404, message: "Profile not found" });

  // Also fetch voice slabs if applicable
  let voiceSlabs: any[] = [];
  if ((channel === "voice" || channel === "ai_calling") && profile.id) {
    voiceSlabs = await (db as any)
      .selectFrom("voice_slab_pricing")
      .selectAll()
      .where("pricing_profile_id", "=", profile.id)
      .orderBy("slab_order", "asc")
      .execute();
  }

  return reply.send({ status: 1, statuscode: 200, message: "Profile fetched", data: { ...profile, voice_slabs: voiceSlabs } });
};

// ── POST /billing/pricing ───────────────────────────────────────
export const createPricingProfile = async (
  req: FastifyRequest<{ Body: any }>,
  reply: FastifyReply,
): Promise<void> => {
  const createdBy = (req as any).user?.username;
  if (!createdBy) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const body = req.body as any;
  const { target_username, channel, category, voice_slabs, ...rates } = body;
  const username = target_username ?? createdBy;

  // Basic validation
  if (!channel || !category) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "channel and category are required" });
  }

  const input: PricingProfileInput = {
    username,
    channel,
    category,
    ratePerUnit:       parseFloat(rates.rate_per_unit      ?? 0),
    connectionCharge:  parseFloat(rates.connection_charge  ?? 0),
    pulseSeconds:      parseInt(rates.pulse_seconds        ?? 0, 10),
    durationRate:      parseFloat(rates.duration_rate      ?? 0),
    aiProcessingCost:  parseFloat(rates.ai_processing_cost ?? 0),
    cpc:               parseFloat(rates.cpc                ?? 0),
    cpl:               parseFloat(rates.cpl                ?? 0),
    billingMode:       rates.billing_mode ?? "submission",
    billOnSent:        rates.bill_on_sent        ? 1 : 0,
    billOnDelivered:   rates.bill_on_delivered   !== undefined ? (rates.bill_on_delivered   ? 1 : 0) : 1,
    billOnRead:        rates.bill_on_read        ? 1 : 0,
    billOnFailed:      rates.bill_on_failed      ? 1 : 0,
    billOnBlocked:     rates.bill_on_blocked     ? 1 : 0,
    refundOnFailed:    rates.refund_on_failed    ? 1 : 0,
    refundOnBlocked:   rates.refund_on_blocked   ? 1 : 0,
    createdBy,
  };

  // Validate inheritance constraint
  try {
    await validateRatesAgainstParent(input);
  } catch (err: any) {
    return reply.status(422).send({ status: 0, statuscode: 422, message: err.message });
  }

  // Upsert pricing profile
  const existing = await getProfile(username, channel, category);

  let profileId: number;

  if (existing) {
    await (db as any)
      .updateTable("pricing_profiles")
      .set({
        rate_per_unit:      input.ratePerUnit,
        connection_charge:  input.connectionCharge,
        pulse_seconds:      input.pulseSeconds,
        duration_rate:      input.durationRate,
        ai_processing_cost: input.aiProcessingCost,
        cpc:                input.cpc,
        cpl:                input.cpl,
        billing_mode:       input.billingMode,
        bill_on_sent:       input.billOnSent,
        bill_on_delivered:  input.billOnDelivered,
        bill_on_read:       input.billOnRead,
        bill_on_failed:     input.billOnFailed,
        bill_on_blocked:    input.billOnBlocked,
        refund_on_failed:   input.refundOnFailed,
        refund_on_blocked:  input.refundOnBlocked,
      })
      .where("username", "=", username)
      .where("channel", "=", channel)
      .where("category", "=", category)
      .execute();
    profileId = Number(existing.id);
  } else {
    const result: any = await (db as any)
      .insertInto("pricing_profiles")
      .values({
        username,
        channel,
        category,
        rate_per_unit:      input.ratePerUnit,
        connection_charge:  input.connectionCharge,
        pulse_seconds:      input.pulseSeconds,
        duration_rate:      input.durationRate,
        ai_processing_cost: input.aiProcessingCost,
        cpc:                input.cpc,
        cpl:                input.cpl,
        billing_mode:       input.billingMode,
        bill_on_sent:       input.billOnSent,
        bill_on_delivered:  input.billOnDelivered,
        bill_on_read:       input.billOnRead,
        bill_on_failed:     input.billOnFailed,
        bill_on_blocked:    input.billOnBlocked,
        refund_on_failed:   input.refundOnFailed,
        refund_on_blocked:  input.refundOnBlocked,
        is_active:          1,
        created_by:         createdBy,
      })
      .execute();
    profileId = Number(result.insertId);
  }

  // Upsert voice slabs if provided
  if (Array.isArray(voice_slabs) && voice_slabs.length > 0 && (channel === "voice" || channel === "ai_calling")) {
    // Delete existing slabs and re-insert
    await (db as any)
      .deleteFrom("voice_slab_pricing")
      .where("pricing_profile_id", "=", profileId)
      .execute();

    for (let i = 0; i < voice_slabs.length; i++) {
      const s = voice_slabs[i];
      await (db as any)
        .insertInto("voice_slab_pricing")
        .values({
          pricing_profile_id: profileId,
          slab_order:         i + 1,
          duration_from_sec:  parseInt(s.duration_from_sec, 10),
          duration_to_sec:    s.duration_to_sec != null ? parseInt(s.duration_to_sec, 10) : null,
          rate_per_pulse:     parseFloat(s.rate_per_pulse),
        })
        .execute();
    }
  }

  return reply.send({ status: 1, statuscode: 200, message: existing ? "Profile updated" : "Profile created", data: { id: profileId } });
};

// ── DELETE /billing/pricing/:channel/:category ──────────────────
export const deletePricingProfile = async (
  req: FastifyRequest<{ Params: { channel: string; category: string }; Querystring: { target_username?: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const callerUsername = (req as any).user?.username;
  if (!callerUsername) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  // Allow admin/parent to delete another user's profile via ?target_username=
  const username = req.query.target_username ?? callerUsername;
  const { channel, category } = req.params;

  await (db as any)
    .updateTable("pricing_profiles")
    .set({ is_active: 0 })
    .where("username", "=", username)
    .where("channel", "=", channel)
    .where("category", "=", category)
    .execute();

  return reply.send({ status: 1, statuscode: 200, message: "Profile deactivated" });
};

// ── GET /billing/pricing/parent-rates/:channel/:category ─────────
// Returns caller's OWN rate for a single channel/category (floor rate for sub-users)
export const getParentRates = async (
  req: FastifyRequest<{ Params: { channel: string; category: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const username = (req as any).user?.username;
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { channel, category } = req.params;

  const profile = await getProfile(username, channel, category);

  return reply.send({ status: 1, statuscode: 200, message: "Own rate fetched", data: profile ?? null });
};
