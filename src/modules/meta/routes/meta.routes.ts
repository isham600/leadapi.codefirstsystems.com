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
  getInsightsTimeseries,
  getInsightsByCampaign,
  getAdAccountInfo,
  getTokenHealth,
  getCampaigns,
  createCampaign,
  updateCampaignStatus,
  deleteCampaign,
  syncMetaData,
  syncMetaLeads,
  getSyncStatus,
  getFormQuestions,
  getFieldMap,
  saveFieldMap,
  uploadAdImage,
  uploadAdVideo,
  targetingSearch,
  getCampaignAdsets,
  getAdsetAds,
  updateAdset,
  listCustomAudiences,
  createCustomAudience,
  getCampaignRoi,
  capiLeadEvent,
  updateFormStatus,
  duplicateLeadForm,
  listMetaAccounts,
  activateMetaAccount,
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
  fastify.get("/lead-forms/:formId/questions", { preHandler: verifyJwt }, getFormQuestions);
  fastify.get("/lead-forms/:formId/field-map", { preHandler: verifyJwt }, getFieldMap);
  fastify.put("/lead-forms/:formId/field-map", { preHandler: verifyJwt }, saveFieldMap);
  fastify.get("/insights",             { preHandler: verifyJwt }, getInsights);
  fastify.get("/insights-timeseries",  { preHandler: verifyJwt }, getInsightsTimeseries);
  fastify.get("/insights-by-campaign", { preHandler: verifyJwt }, getInsightsByCampaign);
  fastify.get("/ad-account-info",     { preHandler: verifyJwt }, getAdAccountInfo);
  fastify.get("/token-health",        { preHandler: verifyJwt }, getTokenHealth);

  // Background sync — cache (lead forms list + campaigns)
  fastify.post("/sync",       { preHandler: verifyJwt }, syncMetaData);
  // Background sync — pull all Meta leads into lead manager
  fastify.post("/sync-leads", { preHandler: verifyJwt }, syncMetaLeads);
  // Real job state for frontend polling
  fastify.get("/sync-status/:jobId", { preHandler: verifyJwt }, getSyncStatus);

  // Campaigns
  fastify.get("/campaigns",        { preHandler: verifyJwt }, getCampaigns);
  fastify.post("/campaigns",       { preHandler: verifyJwt }, createCampaign);
  fastify.patch("/campaigns/:id",  { preHandler: verifyJwt }, updateCampaignStatus);
  fastify.delete("/campaigns/:id", { preHandler: verifyJwt }, deleteCampaign);
  fastify.get("/campaigns/:id/adsets", { preHandler: verifyJwt }, getCampaignAdsets);
  fastify.get("/adsets/:id/ads",       { preHandler: verifyJwt }, getAdsetAds);
  fastify.patch("/adsets/:id",         { preHandler: verifyJwt }, updateAdset);
  fastify.get("/campaign-roi",         { preHandler: verifyJwt }, getCampaignRoi);

  // Creative + targeting helpers
  fastify.post("/ad-images",        { preHandler: verifyJwt }, uploadAdImage);
  fastify.post("/ad-videos",        { preHandler: verifyJwt }, uploadAdVideo);
  fastify.get("/targeting-search",  { preHandler: verifyJwt }, targetingSearch);

  // Custom audiences
  fastify.get("/custom-audiences",  { preHandler: verifyJwt }, listCustomAudiences);
  fastify.post("/custom-audiences", { preHandler: verifyJwt }, createCustomAudience);

  // Conversions API (also fires automatically on lead status change)
  fastify.post("/capi/lead-event",  { preHandler: verifyJwt }, capiLeadEvent);

  // Form management
  fastify.post("/lead-forms/:formId/status",    { preHandler: verifyJwt }, updateFormStatus);
  fastify.post("/lead-forms/:formId/duplicate", { preHandler: verifyJwt }, duplicateLeadForm);

  // Multi-account
  fastify.get("/accounts",               { preHandler: verifyJwt }, listMetaAccounts);
  fastify.post("/accounts/:id/activate", { preHandler: verifyJwt }, activateMetaAccount);

  // Meta webhook (verification + lead delivery)
  fastify.route({
    method: ["GET", "POST"],
    url: "/webhook",
    handler: metaWebhook,
  });
}

//api/meta/connect