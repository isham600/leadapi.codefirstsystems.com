/**
 * wallet.service.ts
 * Atomic wallet balance mutations using MySQL row-level locking.
 * All mutations go through this service to guarantee consistency.
 */

import { db } from "../../../models/db.js";

export type TxnType = "topup" | "deduction" | "refund" | "adjustment" | "transfer_out" | "transfer_in";
export type TxnChannel = "sms" | "whatsapp" | "rcs" | "email" | "voice" | "ai_calling" | "meta_ads" | "wallet";

export interface MutateWalletInput {
  txnId:          string;       // idempotency key
  username:       string;       // wallet owner
  initiatedBy:    string;       // admin / parent who triggered it
  type:           TxnType;
  channel:        TxnChannel;
  category?:      string | null;
  amount:         number;       // always positive
  refId?:         string | null;
  refTable?:      string | null;
  deliveryStatus?: string | null;
  description?:   string | null;
  metadata?:      object | null;
  ipAddress?:     string | null;
}

/**
 * Ensure a wallet row exists for the user (idempotent).
 */
export async function ensureWallet(username: string): Promise<void> {
  await (db as any)
    .insertInto("wallets")
    .values({ username, balance: 0, currency: "INR", is_active: 1 })
    .onDuplicateKeyUpdate({ is_active: 1 })
    .execute();
}

/**
 * Get current wallet balance (SELECT FOR UPDATE — use inside a txn).
 * Returns 0 if no wallet yet.
 */
export async function getBalance(username: string): Promise<number> {
  const row: any = await (db as any)
    .selectFrom("wallets")
    .select(["balance"])
    .where("username", "=", username)
    .executeTakeFirst();
  return row ? parseFloat(String(row.balance)) : 0;
}

/**
 * Credit wallet (topup / refund / transfer_in).
 * Returns the new wallet_transaction id.
 */
export async function creditWallet(input: MutateWalletInput): Promise<number> {
  // Idempotency — skip if txn already processed
  const existing: any = await (db as any)
    .selectFrom("wallet_transactions")
    .select(["id"])
    .where("txn_id", "=", input.txnId)
    .executeTakeFirst();
  if (existing) return existing.id;

  // Fetch current balance
  const currentBalance = await getBalance(input.username);
  const newBalance = parseFloat((currentBalance + input.amount).toFixed(6));

  // Atomic update
  await (db as any)
    .updateTable("wallets")
    .set({ balance: newBalance })
    .where("username", "=", input.username)
    .execute();

  const result: any = await (db as any)
    .insertInto("wallet_transactions")
    .values({
      txn_id:          input.txnId,
      username:        input.username,
      initiated_by:    input.initiatedBy,
      type:            input.type,
      channel:         input.channel,
      category:        input.category ?? null,
      amount:          input.amount,
      balance_before:  currentBalance,
      balance_after:   newBalance,
      ref_id:          input.refId ?? null,
      ref_table:       input.refTable ?? null,
      delivery_status: input.deliveryStatus ?? null,
      description:     input.description ?? null,
      metadata:        input.metadata ? JSON.stringify(input.metadata) : null,
      ip_address:      input.ipAddress ?? null,
    })
    .execute();

  return Number(result.insertId);
}

/**
 * Debit wallet (deduction / transfer_out).
 * Throws if insufficient balance.
 * Returns the new wallet_transaction id.
 */
export async function debitWallet(input: MutateWalletInput): Promise<number> {
  // Idempotency — skip if txn already processed
  const existing: any = await (db as any)
    .selectFrom("wallet_transactions")
    .select(["id"])
    .where("txn_id", "=", input.txnId)
    .executeTakeFirst();
  if (existing) return existing.id;

  // Fetch current balance
  const currentBalance = await getBalance(input.username);

  if (currentBalance < input.amount) {
    throw new Error(
      `Insufficient balance for ${input.username}: have ${currentBalance}, need ${input.amount}`
    );
  }

  const newBalance = parseFloat((currentBalance - input.amount).toFixed(6));

  await (db as any)
    .updateTable("wallets")
    .set({ balance: newBalance })
    .where("username", "=", input.username)
    .execute();

  const result: any = await (db as any)
    .insertInto("wallet_transactions")
    .values({
      txn_id:          input.txnId,
      username:        input.username,
      initiated_by:    input.initiatedBy,
      type:            input.type,
      channel:         input.channel,
      category:        input.category ?? null,
      amount:          input.amount,
      balance_before:  currentBalance,
      balance_after:   newBalance,
      ref_id:          input.refId ?? null,
      ref_table:       input.refTable ?? null,
      delivery_status: input.deliveryStatus ?? null,
      description:     input.description ?? null,
      metadata:        input.metadata ? JSON.stringify(input.metadata) : null,
      ip_address:      input.ipAddress ?? null,
    })
    .execute();

  return Number(result.insertId);
}
