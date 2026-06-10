import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { ensureWallet, creditWallet, getBalance } from "../services/wallet.service.js";

// ── GET /billing/wallet ─────────────────────────────────────────
export const getWallet = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const username = (req as any).user?.username;
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  await ensureWallet(username);
  const balance = await getBalance(username);

  return reply.send({ status: 1, statuscode: 200, message: "Wallet fetched", data: { username, balance, currency: "INR" } });
};

// ── GET /billing/wallet/transactions ────────────────────────────
export const getTransactions = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string; type?: string; channel?: string; from?: string; to?: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const username = (req as any).user?.username;
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { page = "1", limit = "20", type, channel, from, to } = req.query;
  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
  const offset   = (pageNum - 1) * limitNum;

  let q = (db as any)
    .selectFrom("wallet_transactions")
    .where("username", "=", username);

  let cq = (db as any)
    .selectFrom("wallet_transactions")
    .where("username", "=", username);

  if (type)    { q = q.where("type", "=", type);       cq = cq.where("type", "=", type); }
  if (channel) { q = q.where("channel", "=", channel); cq = cq.where("channel", "=", channel); }
  if (from)    { q = q.where("created_at", ">=", new Date(from)); cq = cq.where("created_at", ">=", new Date(from)); }
  if (to)      { q = q.where("created_at", "<=", new Date(to));   cq = cq.where("created_at", "<=", new Date(to)); }

  const [rows, [{ total }]] = await Promise.all([
    q.selectAll().orderBy("id", "desc").limit(limitNum).offset(offset).execute(),
    cq.select((eb: any) => eb.fn.countAll().as("total")).execute(),
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

// ── POST /billing/wallet/topup  (self or admin topping up another user) ─────
export const topupWallet = async (
  req: FastifyRequest<{ Body: { target_username?: string; amount: number; description?: string } }>,
  reply: FastifyReply,
): Promise<void> => {
  const initiatedBy = (req as any).user?.username;
  if (!initiatedBy) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { amount, description } = req.body;
  // Default target to self when not provided
  const target_username = req.body.target_username?.trim() || initiatedBy;

  if (!amount || amount <= 0) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "A positive amount is required" });
  }

  // Verify target user exists
  const targetUser: any = await (db as any)
    .selectFrom("users")
    .select(["username"])
    .where("username", "=", target_username)
    .executeTakeFirst();

  if (!targetUser) {
    return reply.status(404).send({ status: 0, statuscode: 404, message: "Target user not found" });
  }

  await ensureWallet(target_username);

  const txnId = `topup-${target_username}-${Date.now()}`;
  const txnDbId = await creditWallet({
    txnId,
    username:    target_username,
    initiatedBy,
    type:        "topup",
    channel:     "wallet",
    amount:      parseFloat(amount.toFixed(6)),
    description: description ?? `Topup by ${initiatedBy}`,
  });

  const newBalance = await getBalance(target_username);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Wallet topped up",
    data: { txn_id: txnId, txn_db_id: txnDbId, new_balance: newBalance },
  });
};
