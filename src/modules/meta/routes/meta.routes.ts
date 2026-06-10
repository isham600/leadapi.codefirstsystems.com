import { FastifyInstance } from "fastify";
import { verifyJwt } from "../../Middleware/auth.Middleware.js";
import {
  metaConnect,
  metaCallback,
  metaOAuthStart,
  metaOAuthCallback,
  createMetaForm,
  metaWebhook,
  getMetaAccount,
  upsertMetaAccount,
  deleteMetaAccount,
  getPageInfo,
  getInstagramInfo,
  getLeadForms,
  createLeadFormApi,
  getFormLeads,
  getInsights,
  getCampaigns,
  createCampaign,
  updateCampaignStatus,
  syncMetaData,
  syncMetaLeads,
  MetaOAuthCallbackQuery,
  MetaFormCreateBody,
} from "../controllers/meta.controller.js";

export default async function metaRoutes(fastify: FastifyInstance) {
  // OAuth connect (redirects to Meta/Facebook dialog)
  fastify.get("/connect", { preHandler: verifyJwt }, metaConnect);

  // OAuth callback (requires logged-in client via cookies/JWT)
  // fastify.get("/callback", { preHandler: verifyJwt }, metaCallback);

  // // Create Meta lead form for the authenticated client
  // fastify.post("/forms", { preHandler: verifyJwt }, createMetaForm);

  fastify.get<{ Querystring: MetaOAuthCallbackQuery }>("/callback", { preHandler: verifyJwt }, metaCallback);

  // Create Meta lead form for the authenticated client
  fastify.post<{ Body: MetaFormCreateBody }>("/forms", { preHandler: verifyJwt }, createMetaForm);

  // ── New CSRF-safe OAuth flow ────────────────────────────────────────────────
  // Step 1: browser navigates here → verifies JWT from ?token=, stores CSRF
  //         state cookie, redirects to Facebook
  fastify.get<{ Querystring: { token?: string } }>("/oauth/start", metaOAuthStart);

  // Step 2: Facebook redirects here after user approves
  //         → verifies CSRF cookie, exchanges code, saves token, redirects to
  //         FRONTEND_URL/integrations
  fastify.get<{ Querystring: MetaOAuthCallbackQuery }>("/oauth/callback", metaOAuthCallback);

  // Manual account CRUD
  fastify.get("/account",    { preHandler: verifyJwt }, getMetaAccount);
  fastify.post("/account",   { preHandler: verifyJwt }, upsertMetaAccount);
  fastify.delete("/account", { preHandler: verifyJwt }, deleteMetaAccount);

  // Meta Graph API proxies
  fastify.get("/page-info",       { preHandler: verifyJwt }, getPageInfo);
  fastify.get("/instagram-info",  { preHandler: verifyJwt }, getInstagramInfo);
  fastify.get("/lead-forms",                   { preHandler: verifyJwt }, getLeadForms);
  fastify.post("/lead-forms",                  { preHandler: verifyJwt }, createLeadFormApi);
  fastify.get("/lead-forms/:formId/leads",     { preHandler: verifyJwt }, getFormLeads);
  fastify.get("/insights",    { preHandler: verifyJwt }, getInsights);

  // Background sync — cache (lead forms list + campaigns)
  fastify.post("/sync",       { preHandler: verifyJwt }, syncMetaData);
  // Background sync — pull all Meta leads into lead manager
  fastify.post("/sync-leads", { preHandler: verifyJwt }, syncMetaLeads);

  // Campaigns
  fastify.get("/campaigns",        { preHandler: verifyJwt }, getCampaigns);
  fastify.post("/campaigns",       { preHandler: verifyJwt }, createCampaign);
  fastify.patch("/campaigns/:id",  { preHandler: verifyJwt }, updateCampaignStatus);

  // Meta webhook (verification + lead delivery)
  fastify.route({
    method: ["GET", "POST"],
    url: "/webhook",
    handler: metaWebhook,
  });
}

//api/meta/connect