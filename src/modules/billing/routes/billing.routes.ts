import type { FastifyInstance } from "fastify";
import { verifyJwt } from "../../Middleware/auth.Middleware.js";
import { getWallet, getTransactions, topupWallet } from "../controllers/wallet.controller.js";
import { createOrder, verifyPayment } from "../controllers/razorpay.controller.js";
import {
  getPricingProfiles,
  getSingleProfile,
  createPricingProfile,
  deletePricingProfile,
  getParentRates,
} from "../controllers/pricing.controller.js";
import {
  getAllWallets,
  adminAdjustment,
  adminTransfer,
  getQueueStats,
  getAllTransactions,
  getAllPricingProfiles,
} from "../controllers/admin.controller.js";

export default async function billingRoutes(fastify: FastifyInstance) {
  // ── Wallet ────────────────────────────────────────────────────
  fastify.get("/wallet",                    { preHandler: verifyJwt }, getWallet);
  fastify.get("/wallet/transactions",       { preHandler: verifyJwt }, getTransactions);
  fastify.post("/wallet/topup",             { preHandler: verifyJwt }, topupWallet);
  fastify.post("/wallet/create-order",      { preHandler: verifyJwt }, createOrder);
  fastify.post("/wallet/verify-payment",    { preHandler: verifyJwt }, verifyPayment);

  // ── Pricing ───────────────────────────────────────────────────
  fastify.get("/pricing",                                 { preHandler: verifyJwt }, getPricingProfiles);
  fastify.get("/pricing/parent-rates/:channel/:category", { preHandler: verifyJwt }, getParentRates);
  fastify.get("/pricing/:channel/:category",              { preHandler: verifyJwt }, getSingleProfile);
  fastify.post("/pricing",                                { preHandler: verifyJwt }, createPricingProfile);
  fastify.delete("/pricing/:channel/:category",           { preHandler: verifyJwt }, deletePricingProfile);

  // ── Admin ─────────────────────────────────────────────────────
  fastify.get("/admin/wallets",             { preHandler: verifyJwt }, getAllWallets);
  fastify.post("/admin/adjustment",         { preHandler: verifyJwt }, adminAdjustment);
  fastify.post("/admin/transfer",           { preHandler: verifyJwt }, adminTransfer);
  fastify.get("/admin/queue",               { preHandler: verifyJwt }, getQueueStats);
  fastify.get("/admin/transactions",        { preHandler: verifyJwt }, getAllTransactions);
  fastify.get("/admin/pricing",             { preHandler: verifyJwt }, getAllPricingProfiles);
}
