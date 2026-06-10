/**
 * MailBillingService.ts
 * Atomic wallet billing for email campaigns.
 *
 * Called at campaign submit time (recipient count is known upfront).
 * Transaction order:
 *   1. Look up pricing_profiles for email channel
 *   2. INSERT IGNORE wallet row (ensure exists)
 *   3. SELECT FOR UPDATE on wallet (prevent double-billing)
 *   4. Calculate affordable count = min(total, floor(balance / rate))
 *   5. Deduct balance + record wallet_transaction
 *
 * Returns:
 *   { ok: false }             — cannot afford even 1 email
 *   { ok: true, skip: true }  — no pricing configured → let through free
 *   { ok: true, skip: false } — billed successfully (may be partial)
 */

import { sql } from "kysely";
import { db }  from "../../../models/db.js";
import crypto  from "crypto";

const genTxnId = (campaignId: string) =>
  `mail-${campaignId}-${crypto.randomBytes(4).toString("hex")}`;

export type MailBillingResult =
  | { ok: false;  skip: false; reason: "insufficient_balance"; balance: number; rate: number }
  | { ok: true;   skip: true;  reason: "no_pricing" | "zero_rate" }
  | { ok: true;   skip: false; affordable: number; leftover: number; charged: number; balance_after: number; category: string };

/**
 * Atomically bill an email campaign and return how many emails are affordable.
 *
 * @param campaignId  - Campaign ID (used as ref_id in wallet_transactions)
 * @param username    - Account owner
 * @param total       - Total recipients requested
 */
export async function billMailCampaign(
  campaignId: string,
  username:   string,
  total:      number,
): Promise<MailBillingResult> {
  try {
    return await (db as any).transaction().execute(async (trx: any) => {

      // ── 1. Get pricing profile for email ──────────────────────────────────
      const pricing = await trx
        .selectFrom("pricing_profiles")
        .select(["rate_per_unit", "category"])
        .where("username",  "=", username)
        .where("channel",   "=", "email")
        .where("is_active", "=", 1)
        .limit(1)
        .executeTakeFirst();

      if (!pricing) {
        return { ok: true, skip: true, reason: "no_pricing" } as MailBillingResult;
      }

      const rate     = parseFloat(pricing.rate_per_unit) || 0;
      const category = (pricing.category as string) || "bulk";

      if (rate <= 0) {
        return { ok: true, skip: true, reason: "zero_rate" } as MailBillingResult;
      }

      // ── 2. Ensure wallet row exists ───────────────────────────────────────
      await sql`
        INSERT IGNORE INTO wallets (username, balance, currency, is_active, created_at, updated_at)
        VALUES (${username}, 0.000000, 'INR', 1, NOW(), NOW())
      `.execute(trx);

      // ── 3. Lock wallet row ────────────────────────────────────────────────
      const walletResult = await sql<{ balance: number }>`
        SELECT balance FROM wallets WHERE username = ${username} FOR UPDATE
      `.execute(trx);

      const balance = parseFloat(String(walletResult.rows[0]?.balance ?? 0));

      // ── 4. Calculate affordable count ─────────────────────────────────────
      const affordable = Math.min(total, Math.floor(balance / rate));
      const leftover   = total - affordable;

      if (affordable === 0) {
        return { ok: false, skip: false, reason: "insufficient_balance", balance, rate } as MailBillingResult;
      }

      // ── 5. Deduct balance ─────────────────────────────────────────────────
      const charged    = parseFloat((rate * affordable).toFixed(6));
      const newBalance = parseFloat((balance - charged).toFixed(6));
      const txnId      = genTxnId(campaignId);

      await sql`
        UPDATE wallets SET balance = ${newBalance}, updated_at = NOW()
        WHERE username = ${username}
      `.execute(trx);

      await trx
        .insertInto("wallet_transactions")
        .values({
          txn_id:         txnId,
          username,
          initiated_by:   username,
          type:           "deduction",
          channel:        "email",
          category,
          amount:         charged,
          balance_before: balance,
          balance_after:  newBalance,
          ref_id:         campaignId,
          ref_table:      "mail_camp_summary",
          description:    JSON.stringify({
            campaign_id:     campaignId,
            product:         "email",
            event:           "charged",
            category,
            message_count:   affordable,
            rate_per_message: rate,
            currency:        "INR",
            total_amount:    charged,
            balance_before:  balance,
            balance_after:   newBalance,
            description:     `Email ${category} — ${affordable} msg × ₹${rate}`,
          }),
          created_at: new Date(),
        })
        .execute();

      return { ok: true, skip: false, affordable, leftover, charged, balance_after: newBalance, category } as MailBillingResult;
    });
  } catch (err: any) {
    // Log and let campaign through — don't block sending on billing error
    console.error(`[MailBilling] Transaction error for campaign ${campaignId}:`, err.message);
    return { ok: true, skip: true, reason: "no_pricing" };
  }
}
