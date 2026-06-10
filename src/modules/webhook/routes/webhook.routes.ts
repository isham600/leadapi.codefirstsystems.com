import type { FastifyInstance } from "fastify";
import { webhookMiddleware }   from "../middleware/webhook.middleware.js";
import { verifyWebhook, receiveWebhook } from "../controllers/webhook.controller.js";
import {
  getWebhookLogs,
  getWebhookSettings,
  updateWebhookSettings,
} from "../controllers/webhook-logs.controller.js";
import {
  listConversations,
  getConversationMessages,
  markAsRead,
  toggleStar,
  assignConversation,
  resolveConversation,
  updateNotes,
  listTeamInbox,
} from "../controllers/inbox.controller.js";
import {
  listForwardUrls,
  addForwardUrl,
  updateForwardUrl,
  deleteForwardUrl,
} from "../controllers/forward-urls.controller.js";
import { sendMessage, sendFile, sendRcsMessage, sendRcsFile, uploadWorkflowMedia } from "../controllers/send-message.controller.js";
import {
  listRcsAccounts,
  createRcsAccount,
  updateRcsAccount,
  deleteRcsAccount,
} from "../controllers/rcs-accounts.controller.js";
import { exportChat } from "../controllers/export-chat.controller.js";
import {
  listFlows,
  createFlow,
  updateFlow,
  deleteFlow,
  listSteps,
  addStep,
  updateStep,
  deleteStep,
  listSessions,
} from "../controllers/chatbot-flows.controller.js";
import { verifyJwt } from "../../Middleware/auth.Middleware.js";

export default async function webhookRoutes(fastify: FastifyInstance) {

  // ── Public: Hub challenge verification (GET) ────────────────
  fastify.get<{ Params: { uuid: string; channel: string }; Querystring: Record<string, string> }>(
    "/:uuid/:channel", verifyWebhook);

  // ── Public: Receive inbound webhook (POST) ──────────────────
  fastify.post<{ Params: { uuid: string; channel: string } }>(
    "/:uuid/:channel",
    { preHandler: webhookMiddleware },
    receiveWebhook);

  // ── Webhook settings ────────────────────────────────────────
  fastify.get("/auth/settings",  { preHandler: verifyJwt }, getWebhookSettings);
  fastify.put<{ Body: { channel: string; verify_token_enabled?: boolean; verify_token?: string } }>(
    "/auth/settings",            { preHandler: verifyJwt }, updateWebhookSettings);

  // ── Inbound logs ─────────────────────────────────────────────
  fastify.get<{ Querystring: { page?: string; limit?: string; channel?: string } }>(
    "/auth/logs",                { preHandler: verifyJwt }, getWebhookLogs);

  // ── Inbox / Conversations ────────────────────────────────────
  fastify.get<{ Querystring: { page?: string; limit?: string; channel?: string; status?: string; unread?: string; starred?: string; search?: string; assigned_to?: string } }>(
    "/auth/inbox",               { preHandler: verifyJwt }, listConversations);

  // ── Team Inbox (agent-filtered) ──────────────────────────────
  fastify.get<{ Querystring: { page?: string; limit?: string; channel?: string; status?: string; unread?: string; agent?: string; search?: string } }>(
    "/auth/team-inbox",          { preHandler: verifyJwt }, listTeamInbox);

  fastify.get<{ Params: { conversationId: string }; Querystring: { page?: string; limit?: string } }>(
    "/auth/inbox/:conversationId/messages",   { preHandler: verifyJwt }, getConversationMessages);

  fastify.put<{ Params: { conversationId: string } }>(
    "/auth/inbox/:conversationId/read",       { preHandler: verifyJwt }, markAsRead);

  fastify.put<{ Params: { conversationId: string }; Body: { is_starred: boolean } }>(
    "/auth/inbox/:conversationId/star",       { preHandler: verifyJwt }, toggleStar);

  fastify.put<{ Params: { conversationId: string }; Body: { assigned_to: string } }>(
    "/auth/inbox/:conversationId/assign",     { preHandler: verifyJwt }, assignConversation);

  fastify.put<{ Params: { conversationId: string } }>(
    "/auth/inbox/:conversationId/resolve",    { preHandler: verifyJwt }, resolveConversation);

  fastify.put<{ Params: { conversationId: string }; Body: { notes: string } }>(
    "/auth/inbox/:conversationId/notes",      { preHandler: verifyJwt }, updateNotes);

  // ── Export chat ───────────────────────────────────────────────
  fastify.get<{ Params: { conversationId: string }; Querystring: { format?: string } }>(
    "/auth/inbox/:conversationId/export",    { preHandler: verifyJwt }, exportChat);

  // ── Send messages (outbound) ──────────────────────────────────
  // JSON: text / template / media by URL
  fastify.post<{ Params: { conversationId: string }; Body: any }>(
    "/auth/inbox/:conversationId/send",       { preHandler: verifyJwt }, sendMessage);

  // Multipart: upload file + send
  fastify.post<{ Params: { conversationId: string } }>(
    "/auth/inbox/:conversationId/send-file",  { preHandler: verifyJwt }, sendFile);

  // Workflow media upload — returns URL only (no send)
  fastify.post("/auth/workflow/upload-media", { preHandler: verifyJwt }, uploadWorkflowMedia);

  // RCS: send text / image / video / document by URL
  fastify.post<{ Params: { conversationId: string }; Body: any }>(
    "/auth/inbox/:conversationId/send-rcs",      { preHandler: verifyJwt }, sendRcsMessage);

  // RCS: upload file + send via RCS
  fastify.post<{ Params: { conversationId: string } }>(
    "/auth/inbox/:conversationId/send-rcs-file", { preHandler: verifyJwt }, sendRcsFile);

  // ── RCS accounts (integration management) ────────────────────
  fastify.get( "/auth/rcs/accounts",                                   { preHandler: verifyJwt }, listRcsAccounts);
  fastify.post<{ Body: any }>("/auth/rcs/accounts",                    { preHandler: verifyJwt }, createRcsAccount);
  fastify.put<{ Params: { id: string }; Body: any }>("/auth/rcs/accounts/:id",  { preHandler: verifyJwt }, updateRcsAccount);
  fastify.delete<{ Params: { id: string } }>("/auth/rcs/accounts/:id",          { preHandler: verifyJwt }, deleteRcsAccount);

  // ── Chatbot flows ─────────────────────────────────────────────
  fastify.get( "/auth/chatbot/flows",                              { preHandler: verifyJwt }, listFlows);
  fastify.post<{ Body: any }>("/auth/chatbot/flows",               { preHandler: verifyJwt }, createFlow);
  fastify.put<{ Params: { id: string }; Body: any }>("/auth/chatbot/flows/:id",               { preHandler: verifyJwt }, updateFlow);
  fastify.delete<{ Params: { id: string } }>("/auth/chatbot/flows/:id",                       { preHandler: verifyJwt }, deleteFlow);

  fastify.get<{ Params: { id: string } }>("/auth/chatbot/flows/:id/steps",                    { preHandler: verifyJwt }, listSteps);
  fastify.post<{ Params: { id: string }; Body: any }>("/auth/chatbot/flows/:id/steps",        { preHandler: verifyJwt }, addStep);
  fastify.put<{ Params: { id: string; stepId: string }; Body: any }>("/auth/chatbot/flows/:id/steps/:stepId",  { preHandler: verifyJwt }, updateStep);
  fastify.delete<{ Params: { id: string; stepId: string } }>("/auth/chatbot/flows/:id/steps/:stepId",         { preHandler: verifyJwt }, deleteStep);

  fastify.get<{ Querystring: { page?: string; limit?: string; status?: string } }>(
    "/auth/chatbot/sessions",                 { preHandler: verifyJwt }, listSessions);

  // ── Forward URLs ─────────────────────────────────────────────
  fastify.get(
    "/auth/forward-urls",                     { preHandler: verifyJwt }, listForwardUrls);

  fastify.post<{ Body: { url: string; channel?: string } }>(
    "/auth/forward-urls",                     { preHandler: verifyJwt }, addForwardUrl);

  fastify.put<{ Params: { id: string }; Body: { url?: string; channel?: string; status?: string } }>(
    "/auth/forward-urls/:id",                 { preHandler: verifyJwt }, updateForwardUrl);

  fastify.delete<{ Params: { id: string } }>(
    "/auth/forward-urls/:id",                 { preHandler: verifyJwt }, deleteForwardUrl);
}
