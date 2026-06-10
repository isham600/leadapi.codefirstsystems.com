/**
 * admin.controller.ts
 * Admin-only endpoints: view all wallets, force topup/adjustment, deduction queue stats.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { ensureWallet, creditWallet, debitWallet, getBalance } from "../services/wallet.service.js";

/**
 * Recursively collect all usernames that are descendants of `root`.
 * Includes root itself. Capped at 8 levels to prevent runaway queries.
 */
async function getHierarchyUsernames(root: string, maxDepth = 8): Promise<string[]> {
  const all = new Set<string>([root]);
  let current = [root];

  for (let depth = 0; depth < maxDepth && current.length > 0; depth++) {
    const children: any[] = await (db as any)
      .selectFrom("users")
      .select("username")
      .where("parent_username", "in", current)
      .execute();

    const next = children.map((r: any) => r.username).filter((u: string) => !all.has(u));
    next.forEach((u: string) => all.add(u));
    current = next;
  }

  return Array.from(all);
}

// ── GET /billing/admin/wallets ───────────────────────────────────
export const getAllWallets = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string; search?: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const admin = (req as any).user;
  if (!admin?.username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { page = "1", limit = "20", search } = req.query;
  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset   = (pageNum - 1) * limitNum;

  // Only show wallets belonging to users within the caller's hierarchy
  const hierarchyUsers = await getHierarchyUsernames(admin.username);
  // Exclude the caller's own wallet from the list (they see their own in the Wallet tab)
  const subUsers = hierarchyUsers.filter((u: string) => u !== admin.username);

  if (subUsers.length === 0) {
    return reply.send({
      status: 1, statuscode: 200, message: "Wallets fetched",
      pagination: { page: pageNum, limit: limitNum, total: 0, total_pages: 0 },
      data: [],
    });
  }

  let q  = (db as any).selectFrom("wallets").selectAll().where("username", "in", subUsers);
  let cq = (db as any).selectFrom("wallets").select((eb: any) => eb.fn.countAll().as("total")).where("username", "in", subUsers);

  if (search) {
    q  = q.where("username",  "like", `%${search}%`);
    cq = cq.where("username", "like", `%${search}%`);
  }

  const [rows, [{ total }]] = await Promise.all([
    q.orderBy("balance", "desc").limit(limitNum).offset(offset).execute(),
    cq.execute(),
  ]);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Wallets fetched",
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: parseInt(String(total), 10),
      total_pages: Math.ceil(parseInt(String(total), 10) / limitNum),
    },
    data: rows,
  });
};

// ── POST /billing/admin/adjustment ──────────────────────────────
// Force credit or debit any wallet (admin correction)
export const adminAdjustment = async (
  req: FastifyRequest<{ Body: { target_username: string; amount: number; direction: "credit" | "debit"; description?: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const admin = (req as any).user;
  if (!admin?.username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { target_username, amount, direction, description } = req.body;

  if (!target_username || !amount || amount <= 0 || !["credit", "debit"].includes(direction)) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "target_username, positive amount, and direction (credit|debit) are required" });
  }

  // Verify target is within caller's hierarchy (direct or indirect sub-user)
  const hierarchyUsers = await getHierarchyUsernames(admin.username);
  if (!hierarchyUsers.includes(target_username) || target_username === admin.username) {
    return reply.status(403).send({ status: 0, statuscode: 403, message: "Access denied: user not in your hierarchy" });
  }

  await ensureWallet(target_username);

  const txnId   = `adj-${target_username}-${Date.now()}`;
  const parsedAmt = parseFloat(amount.toFixed(6));

  let txnDbId: number;
  if (direction === "credit") {
    txnDbId = await creditWallet({
      txnId,
      username:    target_username,
      initiatedBy: admin.username,
      type:        "adjustment",
      channel:     "wallet",
      amount:      parsedAmt,
      description: description ?? `Admin credit adjustment by ${admin.username}`,
    });
  } else {
    try {
      txnDbId = await debitWallet({
        txnId,
        username:    target_username,
        initiatedBy: admin.username,
        type:        "adjustment",
        channel:     "wallet",
        amount:      parsedAmt,
        description: description ?? `Admin debit adjustment by ${admin.username}`,
      });
    } catch (err: any) {
      return reply.status(422).send({ status: 0, statuscode: 422, message: err.message });
    }
  }

  const newBalance = await getBalance(target_username);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: `Adjustment applied`,
    data: { txn_id: txnId, txn_db_id: txnDbId, direction, amount: parsedAmt, new_balance: newBalance },
  });
};

// ── GET /billing/admin/queue ─────────────────────────────────────
// Deduction queue stats (pending, failed, processed counts)
export const getQueueStats = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const admin = (req as any).user;
  if (!admin?.username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const [pending, processed, errored] = await Promise.all([
    (db as any)
      .selectFrom("billing_deduction_queue")
      .select((eb: any) => eb.fn.countAll().as("cnt"))
      .where("processed", "=", 0)
      .executeTakeFirst(),
    (db as any)
      .selectFrom("billing_deduction_queue")
      .select((eb: any) => eb.fn.countAll().as("cnt"))
      .where("processed", "=", 1)
      .executeTakeFirst(),
    (db as any)
      .selectFrom("billing_deduction_queue")
      .select((eb: any) => eb.fn.countAll().as("cnt"))
      .where("processed", "=", 0)
      .where("retry_count", ">", 0)
      .executeTakeFirst(),
  ]);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Queue stats fetched",
    data: {
      pending:   parseInt(String(pending?.cnt   ?? 0), 10),
      processed: parseInt(String(processed?.cnt ?? 0), 10),
      errored:   parseInt(String(errored?.cnt   ?? 0), 10),
    },
  });
};

// ── GET /billing/admin/transactions ─────────────────────────────
// All transactions (admin view — any username)
export const getAllTransactions = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string; username?: string; type?: string; channel?: string; from?: string; to?: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const admin = (req as any).user;
  if (!admin?.username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { page = "1", limit = "20", username, type, channel, from, to } = req.query;
  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
  const offset   = (pageNum - 1) * limitNum;

  // Restrict to caller's hierarchy only
  const hierarchyUsers = await getHierarchyUsernames(admin.username);

  let q  = (db as any).selectFrom("wallet_transactions").where("username", "in", hierarchyUsers);
  let cq = (db as any).selectFrom("wallet_transactions").select((eb: any) => eb.fn.countAll().as("total")).where("username", "in", hierarchyUsers);

  // If a specific username is requested, ensure it's within the hierarchy
  if (username) {
    if (!hierarchyUsers.includes(username)) {
      return reply.status(403).send({ status: 0, statuscode: 403, message: "Access denied: user not in your hierarchy" });
    }
    q  = q.where("username", "=", username);
    cq = cq.where("username", "=", username);
  }
  if (type)    { q = q.where("type", "=", type);       cq = cq.where("type", "=", type); }
  if (channel) { q = q.where("channel", "=", channel); cq = cq.where("channel", "=", channel); }
  if (from)    { q = q.where("created_at", ">=", new Date(from)); cq = cq.where("created_at", ">=", new Date(from)); }
  if (to)      { q = q.where("created_at", "<=", new Date(to));   cq = cq.where("created_at", "<=", new Date(to)); }

  const [rows, [{ total }]] = await Promise.all([
    q.selectAll().orderBy("id", "desc").limit(limitNum).offset(offset).execute(),
    cq.execute(),
  ]);

  const totalCount = parseInt(String(total), 10);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Transactions fetched",
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalCount,
      total_pages: Math.ceil(totalCount / limitNum),
    },
    data: rows,
  });
};

// ── POST /billing/admin/transfer ────────────────────────────────
// Transfer money between wallets:
//   direction "credit" → debit initiator, credit target
//   direction "debit"  → debit target, credit initiator
export const adminTransfer = async (
  req: FastifyRequest<{ Body: { target_username: string; amount: number; direction: "credit" | "debit"; description?: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const admin = (req as any).user;
  if (!admin?.username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { target_username, amount, direction, description } = req.body;

  if (!target_username || !amount || amount <= 0 || !["credit", "debit"].includes(direction)) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "target_username, positive amount, and direction (credit|debit) are required" });
  }

  if (admin.username === target_username) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "Cannot transfer to yourself" });
  }

  // Verify target is within caller's hierarchy (security: prevent cross-hierarchy transfers)
  const hierarchyUsers = await getHierarchyUsernames(admin.username);
  if (!hierarchyUsers.includes(target_username)) {
    return reply.status(403).send({ status: 0, statuscode: 403, message: "Access denied: user not in your hierarchy" });
  }

  await ensureWallet(admin.username);
  await ensureWallet(target_username);

  const parsedAmt  = parseFloat(Number(amount).toFixed(6));
  const ts         = Date.now();

  if (direction === "credit") {
    // Admin sends money to target — check admin has enough
    const adminBalance = await getBalance(admin.username);
    if (adminBalance < parsedAmt) {
      return reply.status(422).send({
        status: 0,
        statuscode: 422,
        message: `Insufficient balance: your wallet has ₹${adminBalance.toFixed(2)}, need ₹${parsedAmt.toFixed(2)}`,
      });
    }

    const desc = description?.trim() || `Transfer to ${target_username} by ${admin.username}`;

    // Debit admin
    await debitWallet({
      txnId:       `tr-out-${admin.username}-${ts}`,
      username:    admin.username,
      initiatedBy: admin.username,
      type:        "transfer_out",
      channel:     "wallet",
      amount:      parsedAmt,
      refId:       target_username,
      description: desc,
    });

    // Credit target
    await creditWallet({
      txnId:       `tr-in-${target_username}-${ts}`,
      username:    target_username,
      initiatedBy: admin.username,
      type:        "transfer_in",
      channel:     "wallet",
      amount:      parsedAmt,
      refId:       admin.username,
      description: desc,
    });

    const [adminNew, targetNew] = await Promise.all([
      getBalance(admin.username),
      getBalance(target_username),
    ]);

    return reply.send({
      status: 1,
      statuscode: 200,
      message: `₹${parsedAmt.toFixed(2)} transferred to ${target_username}`,
      data: {
        direction,
        amount: parsedAmt,
        your_new_balance:   adminNew,
        target_new_balance: targetNew,
      },
    });

  } else {
    // Admin pulls money back from target — check target has enough
    const targetBalance = await getBalance(target_username);
    if (targetBalance < parsedAmt) {
      return reply.status(422).send({
        status: 0,
        statuscode: 422,
        message: `Insufficient balance: ${target_username} has ₹${targetBalance.toFixed(2)}, need ₹${parsedAmt.toFixed(2)}`,
      });
    }

    const desc = description?.trim() || `Deduction from ${target_username} by ${admin.username}`;

    // Debit target
    await debitWallet({
      txnId:       `tr-out-${target_username}-${ts}`,
      username:    target_username,
      initiatedBy: admin.username,
      type:        "transfer_out",
      channel:     "wallet",
      amount:      parsedAmt,
      refId:       admin.username,
      description: desc,
    });

    // Credit admin
    await creditWallet({
      txnId:       `tr-in-${admin.username}-${ts}`,
      username:    admin.username,
      initiatedBy: admin.username,
      type:        "transfer_in",
      channel:     "wallet",
      amount:      parsedAmt,
      refId:       target_username,
      description: desc,
    });

    const [adminNew, targetNew] = await Promise.all([
      getBalance(admin.username),
      getBalance(target_username),
    ]);

    return reply.send({
      status: 1,
      statuscode: 200,
      message: `₹${parsedAmt.toFixed(2)} deducted from ${target_username}`,
      data: {
        direction,
        amount: parsedAmt,
        your_new_balance:   adminNew,
        target_new_balance: targetNew,
      },
    });
  }
};

// ── GET /billing/admin/pricing ───────────────────────────────────
// View all pricing profiles (admin view)
export const getAllPricingProfiles = async (
  req: FastifyRequest<{ Querystring: { username?: string; channel?: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const admin = (req as any).user;
  if (!admin?.username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { username, channel } = req.query;

  // Restrict to caller's hierarchy
  const hierarchyUsers = await getHierarchyUsernames(admin.username);

  // If a specific username is requested, verify it's in the hierarchy
  if (username && !hierarchyUsers.includes(username)) {
    return reply.status(403).send({ status: 0, statuscode: 403, message: "Access denied: user not in your hierarchy" });
  }

  let q = (db as any)
    .selectFrom("pricing_profiles")
    .selectAll()
    .where("is_active", "=", 1)
    .where("username", "in", username ? [username] : hierarchyUsers);

  if (channel) q = q.where("channel", "=", channel);

  const profiles = await q.orderBy("username", "asc").orderBy("channel", "asc").execute();

  return reply.send({ status: 1, statuscode: 200, message: "Profiles fetched", data: profiles });
};
