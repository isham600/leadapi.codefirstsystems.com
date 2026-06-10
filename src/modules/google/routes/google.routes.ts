import { FastifyInstance } from "fastify";
import {
  googleOAuthStart,
  googleOAuthCallback,
  GoogleOAuthCallbackQuery,
} from "../controllers/google.controller.js";
import {
  disconnectGoogle,
  getGoogleConnection,
  getGoogleAccounts,
  getGoogleForms,
  getGoogleLeads,
  syncGoogleLeads,
  type GoogleLeadsQuery,
} from "../controllers/google-ads.controller.js";
import { verifyJwt } from "../../Middleware/auth.Middleware.js";

export default async function googleRoutes(fastify: FastifyInstance) {
  // ── OAuth ────────────────────────────────────────────────────
  fastify.get<{ Querystring: { token?: string } }>(
    "/oauth/start",
    googleOAuthStart
  );

  fastify.get<{ Querystring: GoogleOAuthCallbackQuery }>(
    "/oauth/callback",
    googleOAuthCallback
  );

  // ── Google Ads data endpoints (JWT protected) ────────────────
  fastify.get("/connection", { preHandler: verifyJwt }, getGoogleConnection);
  fastify.get("/accounts",   { preHandler: verifyJwt }, getGoogleAccounts);
  fastify.get("/forms",      { preHandler: verifyJwt }, getGoogleForms);

  fastify.get<{ Querystring: GoogleLeadsQuery }>(
    "/leads",
    { preHandler: verifyJwt },
    getGoogleLeads
  );

  fastify.post("/leads/sync", { preHandler: verifyJwt }, syncGoogleLeads);

  fastify.delete("/disconnect", { preHandler: verifyJwt }, disconnectGoogle);
}
