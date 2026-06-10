import type { FastifyRequest, FastifyReply } from "fastify";
import Razorpay from "razorpay";
import crypto from "crypto";
import { ensureWallet, creditWallet, getBalance } from "../services/wallet.service.js";

const rzp = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

// ── POST /billing/wallet/create-order ───────────────────────────
// Creates a Razorpay order; returns order_id + key_id to frontend
export const createOrder = async (
  req: FastifyRequest<{ Body: { amount: number } }>,
  reply: FastifyReply,
): Promise<void> => {
  const username = (req as any).user?.username;
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { amount } = req.body;
  if (!amount || amount <= 0) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "A positive amount is required" });
  }

  // Razorpay expects amount in paise (1 INR = 100 paise)
  const amountPaise = Math.round(parseFloat(amount.toString()) * 100);

  const order = await rzp.orders.create({
    amount:   amountPaise,
    currency: "INR",
    receipt:  `wallet-${username}-${Date.now()}`,
    notes:    { username },
  });

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Order created",
    data: {
      order_id:  order.id,
      amount:    amountPaise,
      currency:  "INR",
      key_id:    process.env.RAZORPAY_KEY_ID,
    },
  });
};

// ── POST /billing/wallet/verify-payment ─────────────────────────
// Verifies Razorpay signature and credits wallet
export const verifyPayment = async (
  req: FastifyRequest<{
    Body: {
      razorpay_order_id:   string;
      razorpay_payment_id: string;
      razorpay_signature:  string;
      amount:              number; // INR amount (not paise)
    };
  }>,
  reply: FastifyReply,
): Promise<void> => {
  const username = (req as any).user?.username;
  if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized" });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;

  // Verify signature
  const body        = razorpay_order_id + "|" + razorpay_payment_id;
  const expected    = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(body)
    .digest("hex");

  if (expected !== razorpay_signature) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "Payment verification failed — invalid signature" });
  }

  await ensureWallet(username);

  // Use payment_id as txn_id for idempotency
  const txnId = `rzp-${razorpay_payment_id}`;

  const txnDbId = await creditWallet({
    txnId,
    username,
    initiatedBy: username,
    type:        "topup",
    channel:     "wallet",
    amount:      parseFloat(parseFloat(amount.toString()).toFixed(6)),
    description: `Razorpay recharge · ${razorpay_payment_id}`,
  });

  const newBalance = await getBalance(username);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Payment verified and wallet credited",
    data: { txn_id: txnId, txn_db_id: txnDbId, new_balance: newBalance },
  });
};
