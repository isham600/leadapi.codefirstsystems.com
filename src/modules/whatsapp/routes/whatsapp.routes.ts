import { FastifyInstance } from "fastify";
import { verifyJwt } from "../../Middleware/auth.Middleware.js";
import {
  whatsappOAuthStart,
  whatsappOAuthCallback,
  getWhatsappAccount,
  upsertWhatsappAccount,
  deleteWhatsappAccount,
  listPhoneNumbers,
} from "../controllers/whatsapp.controller.js";

export default async function whatsappRoutes(fastify: FastifyInstance) {
  // ── OAuth Flow ─────────────────────────────────────────────────
  // Step 1: User clicks "Login with Meta" → redirects here
  fastify.get<{ Querystring: { token?: string } }>(
    "/oauth/start",
    whatsappOAuthStart
  );

  // Step 2: Meta redirects back here after user approves
  fastify.get<{ Querystring: { code?: string; state?: string } }>(
    "/oauth/callback",
    whatsappOAuthCallback
  );

  // ── Account Management ─────────────────────────────────────────
  fastify.get("/account", { preHandler: verifyJwt }, getWhatsappAccount);
  fastify.post("/account", { preHandler: verifyJwt }, upsertWhatsappAccount);
  fastify.delete("/account", { preHandler: verifyJwt }, deleteWhatsappAccount);

  // ── Phone Numbers ──────────────────────────────────────────────
  fastify.get("/phone-numbers", { preHandler: verifyJwt }, listPhoneNumbers);
}
