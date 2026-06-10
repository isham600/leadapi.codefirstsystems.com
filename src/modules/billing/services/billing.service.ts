/**
 * billing.service.ts
 * Core deduction/refund logic — resolves pricing, calculates cost, mutates wallet.
 *
 * Called by:
 *  - WhatsApp campaign worker (submission-based: deduct on send)
 *  - WhatsApp webhook worker (delivery-based: deduct/refund on status update)
 *  - billing-deduction.worker.ts (async queue consumer)
 */

import { db } from "../../../models/db.js";
import { resolveEffectiveProfile } from "./pricing.service.js";
import { creditWallet, debitWallet, ensureWallet, TxnChannel } from "./wallet.service.js";
import { billingDeductionQueue } from "../../../queues/billing-deduction.queue.js";

/**
 * Agents (user_type=5) have no wallet of their own.
 * All billing is done against their parent (the User who owns the team).
 * This helper resolves the effective billing username.
 */
async function resolveBillingUsername(username: string): Promise<string> {
  const row: any = await (db as any)
    .selectFrom("users")
    .select(["user_type", "parent_username"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (row?.user_type === 5 && row?.parent_username) {
    return row.parent_username;
  }
  return username;
}

export interface DeductionRequest {
  username:       string;
  channel:        TxnChannel;
  category:       string;
  refId:          string;        // e.g. whatsapp_camp_details.id
  refTable:       string;        // e.g. "whatsapp_camp_details"
  deliveryStatus: string;        // sent | delivered | read | failed | blocked
  units?:         number;        // default 1
  durationSec?:   number;        // voice calls only
  aiTurns?:       number;        // ai_calling only
  metadata?:      object;
  ipAddress?:     string;
}

export interface RefundRequest {
  username:       string;
  channel:        TxnChannel;
  category:       string;
  refId:          string;
  refTable:       string;
  deliveryStatus: string;        // failed | blocked
  originalTxnId?: string;
  metadata?:      object;
}

/**
 * Calculate voice call cost using slab pricing.
 */
async function calcVoiceCost(
  profileId: number,
  durationSec: number,
  pulseSeconds: number,
  connectionCharge: number,
): Promise<number> {
  const slabs: any[] = await (db as any)
    .selectFrom("voice_slab_pricing")
    .selectAll()
    .where("pricing_profile_id", "=", profileId)
    .orderBy("slab_order", "asc")
    .execute();

  if (!slabs.length) return 0;

  // Find the slab that covers this duration
  const slab = slabs.find((s: any) => {
    const from = Number(s.duration_from_sec);
    const to   = s.duration_to_sec != null ? Number(s.duration_to_sec) : Infinity;
    return durationSec >= from && durationSec <= to;
  }) ?? slabs[slabs.length - 1];

  const pulse    = pulseSeconds > 0 ? pulseSeconds : 1;
  const pulses   = Math.ceil(durationSec / pulse);
  const callCost = pulses * parseFloat(String(slab.rate_per_pulse));

  return parseFloat((connectionCharge + callCost).toFixed(6));
}

/**
 * Calculate the cost for a given request using the resolved pricing profile.
 * Returns 0 if no profile found.
 */
export async function calculateCost(req: DeductionRequest): Promise<number> {
  const profile = await resolveEffectiveProfile(req.username, req.channel, req.category);
  if (!profile) return 0;

  const units = req.units ?? 1;

  if (req.channel === "voice" || req.channel === "ai_calling") {
    const durationSec     = req.durationSec ?? 0;
    const connectionCharge = parseFloat(String(profile.connection_charge));
    const pulseSeconds    = Number(profile.pulse_seconds);

    if (req.channel === "ai_calling") {
      const durationCost = durationSec * parseFloat(String(profile.duration_rate));
      const aiCost       = (req.aiTurns ?? 0) * parseFloat(String(profile.ai_processing_cost));
      return parseFloat((connectionCharge + durationCost + aiCost).toFixed(6));
    }

    return calcVoiceCost(
      Number(profile.id),
      durationSec,
      pulseSeconds,
      connectionCharge,
    );
  }

  // Flat rate channels (sms, whatsapp, rcs, email, meta_ads)
  return parseFloat((units * parseFloat(String(profile.rate_per_unit))).toFixed(6));
}

/**
 * Enqueue a deduction for async processing (delivery-mode billing).
 * If the actor is an agent, enqueues against the parent (user) wallet.
 */
export async function enqueueDeduction(req: DeductionRequest): Promise<void> {
  const billingUsername = await resolveBillingUsername(req.username);
  const txnId = `txn-${req.refId}-${req.channel}-${req.deliveryStatus}`;

  // Idempotency guard
  const existing: any = await (db as any)
    .selectFrom("billing_deduction_queue")
    .select(["id"])
    .where("txn_id", "=", txnId)
    .executeTakeFirst();
  if (existing) return;

  await (db as any)
    .insertInto("billing_deduction_queue")
    .values({
      txn_id:          txnId,
      username:        billingUsername,    // billed to parent if agent
      channel:         req.channel,
      category:        req.category,
      ref_id:          req.refId,
      ref_table:       req.refTable,
      delivery_status: req.deliveryStatus,
      processed:       0,
      retry_count:     0,
    })
    .execute();

  await billingDeductionQueue.add("deduct", {
    txnId,
    username:        billingUsername,
    channel:         req.channel,
    category:        req.category,
    refId:           req.refId,
    refTable:        req.refTable,
    deliveryStatus:  req.deliveryStatus,
  });
}

/**
 * Immediately deduct from wallet (submission-mode billing).
 * If the actor is an agent, deducts from the parent (user) wallet instead.
 */
export async function deductNow(req: DeductionRequest): Promise<void> {
  const billingUsername = await resolveBillingUsername(req.username);
  const profile = await resolveEffectiveProfile(billingUsername, req.channel, req.category);
  if (!profile) return;

  // Only deduct if billing_mode = submission
  if (profile.billing_mode !== "submission") return;

  const amount = await calculateCost({ ...req, username: billingUsername });
  if (amount <= 0) return;

  await ensureWallet(billingUsername);

  const txnId = `txn-${req.refId}-${req.channel}-${req.deliveryStatus}`;
  await debitWallet({
    txnId,
    username:        billingUsername,
    initiatedBy:     req.username,    // keep original actor for audit
    type:            "deduction",
    channel:         req.channel,
    category:        req.category,
    amount,
    refId:           req.refId,
    refTable:        req.refTable,
    deliveryStatus:  req.deliveryStatus,
    metadata:        req.metadata,
    ipAddress:       req.ipAddress,
  });
}

/**
 * Process a delivery-mode deduction (called by worker).
 */
export async function processDeliveryDeduction(
  txnId:          string,
  username:       string,
  channel:        TxnChannel,
  category:       string,
  refId:          string,
  refTable:       string,
  deliveryStatus: string,
): Promise<void> {
  const profile = await resolveEffectiveProfile(username, channel, category);
  if (!profile) {
    await (db as any).updateTable("billing_deduction_queue")
      .set({ processed: 1, processed_at: new Date(), error_message: "No pricing profile" })
      .where("txn_id", "=", txnId).execute();
    return;
  }

  if (profile.billing_mode !== "delivery") {
    await (db as any).updateTable("billing_deduction_queue")
      .set({ processed: 1, processed_at: new Date() })
      .where("txn_id", "=", txnId).execute();
    return;
  }

  const status = deliveryStatus.toLowerCase();
  const shouldBill =
    (status === "sent"      && profile.bill_on_sent)      ||
    (status === "delivered" && profile.bill_on_delivered)  ||
    (status === "read"      && profile.bill_on_read)       ||
    (status === "failed"    && profile.bill_on_failed)     ||
    (status === "blocked"   && profile.bill_on_blocked);

  const shouldRefund =
    (status === "failed"  && profile.refund_on_failed) ||
    (status === "blocked" && profile.refund_on_blocked);

  await ensureWallet(username);

  if (shouldBill) {
    const amount = await calculateCost({ username, channel, category, refId, refTable, deliveryStatus });
    if (amount > 0) {
      await debitWallet({
        txnId,
        username,
        initiatedBy:    username,
        type:           "deduction",
        channel,
        category,
        amount,
        refId,
        refTable,
        deliveryStatus,
      });
    }
  }

  if (shouldRefund) {
    // Look up original deduction
    const original: any = await (db as any)
      .selectFrom("wallet_transactions")
      .select(["amount"])
      .where("ref_id", "=", refId)
      .where("ref_table", "=", refTable)
      .where("type", "=", "deduction")
      .executeTakeFirst();

    const refundAmount = original ? parseFloat(String(original.amount)) : 0;
    if (refundAmount > 0) {
      await creditWallet({
        txnId:          `${txnId}-refund`,
        username,
        initiatedBy:    "system",
        type:           "refund",
        channel,
        category,
        amount:         refundAmount,
        refId,
        refTable,
        deliveryStatus,
        description:    `Refund for ${deliveryStatus} on ${refTable}#${refId}`,
      });
    }
  }

  await (db as any)
    .updateTable("billing_deduction_queue")
    .set({ processed: 1, processed_at: new Date() })
    .where("txn_id", "=", txnId)
    .execute();
}
