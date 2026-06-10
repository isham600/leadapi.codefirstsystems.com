import fastify, { FastifyInstance } from "fastify";

import {
  checkUsername,
  checkPhone,
  checkEmail,
} from "../controllers/availability.check.controller.js";
import {
  registerUser,
  loginUser,
  getLoggedUser,
  logout,
  checkPassword,
  editUserProfile,
  uploadAvatar,
  impersonateUser,
  endImpersonation,
  refreshAccessToken,
} from "../controllers/auth.controller.js";
import {
  sendOtp,
  sendSmsOtpForLead,
  verifySmsOtpForLead,
} from "../utils/smsOtp.js";
import { verifyOtp } from "../utils/verifyOtp.js";
import { resetSendOtp } from "../utils/resetPwOTP.js";
import { resetVerifyOtp } from "../utils/resetVerifyOtp.js";
import { resetPassword } from "../utils/resetPw.js";
//  import { checkSession } from '../../Middleware/authCheckSession';
import { verifyJwt } from "../../Middleware/auth.Middleware.js";
import {
  AllLogoutSession,
  getLoginSession,
  updateLoginSession,
} from "../controllers/getSession.controller.js";
import { changePasswordDashboard } from "../controllers/resetPWProfile.controller.js";
import {
  disableDualVerification,
  enableDualVerification,
  enableEmailDualVerification,
  enablePhoneDualVerification,
  enableQADualVerification,
  getAllQuestions,
  verifyQA,
} from "../controllers/dualverification.controller.js";
import { SendOtpEmail } from "../utils/sendOtpViasEmail.js";
import { verifyEmailOtp } from "../utils/verifyEmail.js";
import { getActivityLogs } from "../controllers/activityLog.controller.js";
import {
  addUserClientManagement,
  exportTransactions,
  getAllTransaction,
  getCurrentUserPermissions,
  getOverviewUsers,
  getSidebarConfig,
  getUserAccounts,
  toggleUserStatus,
  updateUserClientManagement,
  updateUserRoleClientManagement,
} from "../controllers/getUserAccount.controller.js";
import {
  createEmailIntegration,
  createGoogleIntegration,
  createMetaIntegration,
  createWhatsAppIntegration,
} from "../controllers/WhatsAppIntegration.controller.js";
import { addUserSchema } from "../schema/auth.schema.js";

import type { ActivityLogQuery } from "../controllers/activityLog.controller.js";
import type { BodyType } from "../controllers/getUserAccount.controller.js";
import { creditDeductSms } from "../controllers/getUserAccount.controller.js";
import { receiveWebhook } from "../controllers/webhook.controller.js";
import { rbacCreateUser } from "../../../rbac/rbacMiddleware.js";
import { receiveWebhookFacebook } from "../../users/controllers/facebookWebhook.controller.js";
import {
  getLeadById,
  getLeads,
  LeadsQuery,
} from "../controllers/getLeads.controller.js";
import { createLead } from "../controllers/createLead.controller.js";
import { updateLead } from "../controllers/updateLead.controller.js";
// import { captureLead } from "../controllers/capture-lead.controller";
import { captureLeadByGoogle } from "../controllers/google-lead.controller.js";
import { getGoogleAdsUrl } from "../controllers/get_googleAds_url.controller.js";
import { getFacebookWebhookUrl } from "../controllers/get_facebookWebhook_url.controller.js";
import { generateMasterPassword } from "../controllers/generateMasterPassword.controller.js";
import { createMetaForm } from "../../meta/controllers/meta.controller.js";
import {
  getAgents,
  updateLeadAgents,
} from "../controllers/agentsController.js";
import {
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
} from "../controllers/teams.controller.js";
import { getIntegrationStatus } from "../controllers/integrationStatus.controller.js";
import {
  getPhoneAccount,
  upsertPhoneAccount,
  deletePhoneAccount,
  getDids,
  createDid,
  deleteDid,
  getCalls,
  logCall,
  updateCall,
  getCallStats,
  getCallsByLead,
  getQueues,
  createQueue,
  getExtensions,
  createExtension,
  getIvrMenus,
  createIvrMenu,
  getVoicemails,
  markVoicemailRead,
} from "../controllers/phoneIvr.controller.js";
import {
  getAiCredentials,
  upsertAiCredentials,
  deleteAiCredentials,
  listAiTemplates,
  createAiTemplate,
  updateAiTemplate,
  deleteAiTemplate,
  listAiCampaigns,
  createAiCampaign,
  getAiCampaignDetails,
  updateAiCampaignStatus,
  deleteAiCampaign,
  updateCallResult,
  uploadCallRecording,
  conversationTurn,
  markVoicemail,
  getCallLogs,
} from "../controllers/phoneAiCalling.controller.js";
import {
  scheduleFollowUp,
  getLeadFollowUps,
  updateFollowUp,
  getLeadActivities,
} from "../controllers/followup.controller.js";
import {
  getLeadCommunication,
} from "../controllers/communication.controller.js";
import {
  createTemplate,
  getTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from "../controllers/template.controller.js";
import {
  createSenderId,
  getSenderIds,
  getSenderId,
  updateSenderId,
  deleteSenderId,
  makeDefaultSenderId,
  removeDefaultSenderId,
  downloadSenderIdsCSV,
} from "../controllers/senderId.controller.js";
import { submitCampaign, getWhatsappCampaigns, getWhatsappCampaignDetails } from "../controllers/whatsapp.campaign.controller.js";
import { getRcsProfile } from "../controllers/rcsProfile.controller.js";
import { getRcsTemplates, createRcsTemplate, deleteRcsTemplate, updateRcsTemplateStatus } from "../controllers/rcsTemplates.controller.js";
import { getRcsCampaigns, submitRcsCampaign } from "../controllers/rcs.campaign.controller.js";
import { submitSmsCampaign, getSmsCampaigns, getSmsCampaignDetails, getSmsCampaignStats } from "../controllers/sms.campaign.controller.js";
import {
  submitMailCampaign,
  listMailCampaigns,
  getCampaignDetails,
  deleteCampaign,
  pauseCampaign,
  resumeCampaign,
  getMailAnalytics,
} from "../controllers/mail.campaign.controller.js";
import {
  listSmtpAccounts,
  addSmtpAccount,
  updateSmtpAccount,
  deleteSmtpAccount,
  testSmtpAccount,
} from "../controllers/mailSmtpAccounts.controller.js";
import {
  createEmailTemplate,
  getEmailTemplates,
  getEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
} from "../controllers/mailTemplate.controller.js";
import { syncWhatsappTemplates } from "../controllers/whatsappTemplateSync.controller.js";
import {
  getWhatsappTemplates,
  type TemplateQuery,
} from "../controllers/whatsappTemplates.controller.js";
import { createWhatsappTemplate } from "../controllers/whatsappTemplateCreate.controller.js";
import { getWhatsappProfile } from "../controllers/whatsappProfile.controller.js";
import {
  listWhatsappFlows,
  createWhatsappFlow,
  type CreateFlowBody,
} from "../controllers/whatsappFlows.controller.js";
import {
  agentdashboard,
  getadmindashboard,
  getLeadsDashboard,
  getAgentManagementDashboard,
  type GetLeadsDashboardQuery,
} from "../controllers/dashboard.controller.js";
import {
  getSourceAttributionReport,
  getConversionStatsBySource,
  getPipelineHealth,
  getTeamProductivity,
  getLeadsReport,
  getFollowupsReport,
  getActivitiesReport,
  getConversationsReport,
  getDailySummary,
  getLeadAgeing,
  getCampaignAttribution,
  getHotLeads,
  getUnassignedLeads,
  type SourceAttributionQuery,
} from "../controllers/reports.controller.js";

import {
  createWorkflowSchema,
  getWorkflowsSchema,
} from "../schema/chatbotSchema.js";
import {
  createWorkflowController,
  deleteWorkflowController,
  duplicateWorkflowController,
  getWorkflowCanvasController,
  getWorkflowsController,
  saveWorkflowCanvasController,
  updateWorkflowStatusController,
} from "../controllers/chatbotController.js";

import {
  createAutomationController,
  getAutomationsController,
  getAutomationController,
  updateAutomationController,
  updateAutomationStatusController,
  deleteAutomationController,
  duplicateAutomationController,
  getAutomationLogsController,
} from "../controllers/automationController.js";

import {
  getAnalyticsOverview,
  getMessagesTrend,
  getChannelBreakdown,
  getLeadFunnel,
  getLeadScoreDistribution,
  getConversationStatus,
  getAgentPerformance,
  getLeadsTrend,
  getLeadSourcePerformance,
  getMessageTypeBreakdown,
  getHourlyActivity,
  getRecentActivity,
} from "../controllers/analytics.controller.js";
import { getPipelineLeads, getFocusDeals } from "../controllers/pipelineLeads.controller.js";
// import { leadService } from "../controllers/globally-capture-lead.controller";

//
// ───────────────────────────────────────────────────────────
//   📌 MIDDLEWARE
// ───────────────────────────────────────────────────────────
//
// import { authMiddleware } from '../../../middleware/authMiddleware.ts';

export default async function authRoutes(fastify: FastifyInstance) {
  //
  // ═════════════════════════════════════════════════════════════
  //   🔐 AVAILABILITY CHECK ROUTES
  // ═════════════════════════════════════════════════════════════
  //

  fastify.post("/checkUsername", checkUsername);
  fastify.post("/checkPhone", checkPhone);
  fastify.post("/checkEmail", checkEmail);

  //
  // ═════════════════════════════════════════════════════════════
  //   🔐 AUTHENTICATION ROUTES
  // ═════════════════════════════════════════════════════════════
  //
  fastify.post("/registerUser", registerUser);

  fastify.post("/loginUser", loginUser);

  //
  // ═════════════════════════════════════════════════════════════
  //   🔐 OTP ROUTES FOR LOGIN
  // ═════════════════════════════════════════════════════════════
  //
  fastify.post("/sendOtp", sendOtp);

  fastify.post("/verifyOtp", verifyOtp);

  //
  // ═════════════════════════════════════════════════════════════
  //   🔐 OTP ROUTES FOR RESET PASSWORD
  // ═════════════════════════════════════════════════════════════
  //

  fastify.post("/resetSendOtp", resetSendOtp);
  fastify.post("/resetVerifyOtp", resetVerifyOtp);
  fastify.post("/resetPassword", resetPassword);

  // ───────────────────────────────────────────────────────────
  //  🔐 PROTECTED ROUTES (JWT REQUIRED)
  // ───────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────
  //  GET LOGGED USER INFO ROUTE
  // ───────────────────────────────────────────────────────────

  // fastify.get("/checkSession", { preHandler: verifyJwt }, checkSession);

  fastify.get("/getLoggedUser", { preHandler: verifyJwt }, getLoggedUser);

  fastify.post("/logout", logout);
  // fastify.post("/login-with-permanent-token",login-with-permanent-token);

  // ───────────────────────────────────────────────────────────
  //  🔐 GET LOGIN SESSION ROUTE
  // ───────────────────────────────────────────────────────────

  fastify.get("/getLoginSession", { preHandler: verifyJwt }, getLoginSession);

  fastify.patch(
    "/updateLoginSession/:id",
    { preHandler: verifyJwt },
    updateLoginSession,
  );
  fastify.post(
    "/AllLogoutSession",
    { preHandler: verifyJwt },
    AllLogoutSession,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 Change Password fromn dashboard route
  // ───────────────────────────────────────────────────────────

  fastify.post("/checkPassword", checkPassword);

  fastify.post(
    "/changePasswordDashboard",
    { preHandler: verifyJwt },
    changePasswordDashboard,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 Edit Profile from dashboard route
  // ───────────────────────────────────────────────────────────

  fastify.post("/editUserProfile", { preHandler: verifyJwt }, editUserProfile);

  fastify.post("/uploadAvatar", { preHandler: verifyJwt }, uploadAvatar);

  // ───────────────────────────────────────────────────────────
  //  🔐 Dual Verification  from dashboard public route
  // ───────────────────────────────────────────────────────────

  fastify.post("/sendOtpEmail", SendOtpEmail);

  fastify.post("/verifyEmailOtp", verifyEmailOtp);

  fastify.post("/verifyQA", verifyQA);

  // ───────────────────────────────────────────────────────────
  //  🔐 Dual Verification  from dashboard private route
  // ───────────────────────────────────────────────────────────

  fastify.post(
    "/enableEmailDualVerification",
    { preHandler: verifyJwt },
    enableEmailDualVerification,
  );
  fastify.post(
    "/enablePhoneDualVerification",
    { preHandler: verifyJwt },
    enablePhoneDualVerification,
  );

  fastify.post(
    "/enableQADualVerification",
    { preHandler: verifyJwt },
    enableQADualVerification,
  );
  fastify.post(
    "/enableDualVerification",
    { preHandler: verifyJwt },
    enableDualVerification,
  );
  fastify.post(
    "/disableDualVerification",
    { preHandler: verifyJwt },
    disableDualVerification,
  );
  fastify.get("/getAllQuestions", { preHandler: verifyJwt }, getAllQuestions);

  // ───────────────────────────────────────────────────────────
  //  🔐 Activity Logs Route
  // ───────────────────────────────────────────────────────────

  // original path used by docs & some components
  fastify.get<{ Querystring: ActivityLogQuery }>(
    "/activityLogs",
    { preHandler: verifyJwt },
    getActivityLogs,
  );
  // legacy/alternate path matching front-end constant
  fastify.get<{ Querystring: ActivityLogQuery }>(
    "/getActivityLogs",
    { preHandler: verifyJwt },
    getActivityLogs,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 USER MANAGEMENT ROUTES
  // ───────────────────────────────────────────────────────────

  fastify.get("/getUserAccounts", { preHandler: verifyJwt }, getUserAccounts);

  fastify.post(
    "/addUserClientManagement",
    {
      preHandler: [verifyJwt, rbacCreateUser()],
    },
    addUserClientManagement,
  );

  fastify.put(
    "/updateUserClientManagement/:id",
    { preHandler: [verifyJwt, rbacCreateUser()] },
    updateUserClientManagement,
  );
  fastify.put(
    "/updateUserRoleClientManagement/:id",
    { preHandler: [verifyJwt, rbacCreateUser()] },
    updateUserRoleClientManagement,
  );

  fastify.put(
    "/toggleUserStatus/:id",
    { preHandler: verifyJwt },
    toggleUserStatus,
  );

  fastify.get("/getOverviewUsers", { preHandler: verifyJwt }, getOverviewUsers);
  fastify.get("/getUserOverview", { preHandler: verifyJwt }, getOverviewUsers);
  fastify.post("/creditDeductSms", { preHandler: verifyJwt }, creditDeductSms);
  fastify.get("/transactions", { preHandler: verifyJwt }, getAllTransaction);
  fastify.get(
    "/transactions/export",
    { preHandler: verifyJwt },
    exportTransactions,
  );

  // fastify.post<{ Body: BodyType }>("/creditDeductSms", { preHandler: verifyJwt }, creditDeductSms)

  // ───────────────────────────────────────────────────────────
  //  🔐 IMPERSONATE LOGIN ROUTES
  // ───────────────────────────────────────────────────────────

  // Impersonate a user (admin can login as users they created)
  fastify.post("/impersonateUser", { preHandler: verifyJwt }, impersonateUser);

  // End impersonation and return to admin account
  fastify.post(
    "/endImpersonation",
    { preHandler: verifyJwt },
    endImpersonation,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 INTEGRATION ROUTE
  // ───────────────────────────────────────────────────────────

  fastify.post(
    "/WHATSAPPINGREGATION",
    { preHandler: verifyJwt },
    createWhatsAppIntegration,
  );

  fastify.post(
    "/createMetaIntegration",
    { preHandler: verifyJwt },
    createMetaIntegration,
  );
  fastify.post(
    "/createEmailIntegration",
    { preHandler: verifyJwt },
    createEmailIntegration,
  );
  fastify.post(
    "/createGoogleIntegration",
    { preHandler: verifyJwt },
    createGoogleIntegration,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 WEBHOOK  ROUTE
  // ───────────────────────────────────────────────────────────
  fastify.post("/webhooks/:uuid", receiveWebhook);

  // ============================================================
  // 🔹 FACEBOOK WEBHOOK VERIFICATION (GET - NO UUID)
  // ============================================================
  fastify.get("/webhooks", receiveWebhookFacebook);

  // ============================================================
  // 🔹 FACEBOOK WEBHOOK EVENTS (POST - UUID REQUIRED)
  // ============================================================
  fastify.post("/webhooks/facebook/:uuid", receiveWebhookFacebook);
  fastify.get(
    "/getFacebookWebhookUrl",
    { preHandler: verifyJwt },
    getFacebookWebhookUrl,
  );

  // ============================================================
  // 🔹 GOOGLE INTRIGATION GET GOOGLE ADS URL
  // ============================================================

  fastify.get("/getGoogleAdsUrl", { preHandler: verifyJwt }, getGoogleAdsUrl);

  // ============================================================
  // 🔹 CAMPAIGN SUBMIT
  // ============================================================
  fastify.post(
    "/whatsapp/campaign/submit",
    { preHandler: verifyJwt },
    submitCampaign,
  );
  fastify.get("/whatsapp/campaigns", { preHandler: verifyJwt }, getWhatsappCampaigns);
  fastify.get("/whatsapp/campaigns/:requestId/details", { preHandler: verifyJwt }, getWhatsappCampaignDetails);

  // ============================================================
  // 🔹 RCS
  fastify.get("/rcsProfile",           { preHandler: verifyJwt }, getRcsProfile);
  fastify.get("/rcsTemplates",         { preHandler: verifyJwt }, getRcsTemplates);
  fastify.post("/rcsTemplates/create", { preHandler: verifyJwt }, createRcsTemplate);
  fastify.delete<{ Params: { id: string } }>("/rcsTemplates/:id",        { preHandler: verifyJwt }, deleteRcsTemplate as any);
  fastify.put<{ Params: { id: string }; Body: { status: string } }>("/rcsTemplates/:id/status", { preHandler: verifyJwt }, updateRcsTemplateStatus as any);
  fastify.get("/rcs/campaigns",        { preHandler: verifyJwt }, getRcsCampaigns);
  fastify.post("/rcs/campaign/submit", { preHandler: verifyJwt }, submitRcsCampaign);

  // ── SMS Broadcast ────────────────────────────────────────────
  fastify.post("/sms/campaign/submit",                              { preHandler: verifyJwt }, submitSmsCampaign);
  fastify.get("/sms/campaigns",                                     { preHandler: verifyJwt }, getSmsCampaigns);
  fastify.get("/sms/campaigns/:requestId/details",                  { preHandler: verifyJwt }, getSmsCampaignDetails);
  fastify.get("/sms/campaign/stats",                                { preHandler: verifyJwt }, getSmsCampaignStats);

  // ============================================================
  // 🔹 MAIL CAMPAIGN
  // ============================================================
  fastify.post(
    "/mail/campaign/submit",
    { preHandler: verifyJwt },
    submitMailCampaign,
  );

  // ── Mail Campaign Management ──
  fastify.get<{
    Querystring: { page?: string; limit?: string; status?: string };
  }>("/mail/campaigns", { preHandler: verifyJwt }, listMailCampaigns);
  fastify.get("/mail/analytics", { preHandler: verifyJwt }, getMailAnalytics);
  fastify.get<{ Params: { campaignId: string } }>(
    "/mail/campaigns/:campaignId",
    { preHandler: verifyJwt },
    getCampaignDetails,
  );
  fastify.delete<{ Params: { campaignId: string } }>(
    "/mail/campaigns/:campaignId",
    { preHandler: verifyJwt },
    deleteCampaign,
  );
  fastify.put<{ Params: { campaignId: string } }>(
    "/mail/campaigns/:campaignId/pause",
    { preHandler: verifyJwt },
    pauseCampaign,
  );
  fastify.put<{ Params: { campaignId: string } }>(
    "/mail/campaigns/:campaignId/resume",
    { preHandler: verifyJwt },
    resumeCampaign,
  );

  // ── SMTP Accounts (credentials management) ──
  fastify.get(
    "/mail/smtp-accounts",
    { preHandler: verifyJwt },
    listSmtpAccounts,
  );
  fastify.post<{ Body: Parameters<typeof addSmtpAccount>[0]["body"] }>(
    "/mail/smtp-accounts",
    { preHandler: verifyJwt },
    addSmtpAccount as any,
  );
  fastify.put<{ Params: { id: string } }>(
    "/mail/smtp-accounts/:id",
    { preHandler: verifyJwt },
    updateSmtpAccount as any,
  );
  fastify.delete<{ Params: { id: string } }>(
    "/mail/smtp-accounts/:id",
    { preHandler: verifyJwt },
    deleteSmtpAccount as any,
  );
  fastify.post<{ Params: { id: string } }>(
    "/mail/smtp-accounts/:id/test",
    { preHandler: verifyJwt },
    testSmtpAccount as any,
  );

  // ── Email Templates (email template management) ──
  fastify.get("/mail/templates", { preHandler: verifyJwt }, getEmailTemplates);
  fastify.post(
    "/mail/templates",
    { preHandler: verifyJwt },
    createEmailTemplate,
  );
  fastify.get(
    "/mail/templates/:id",
    { preHandler: verifyJwt },
    getEmailTemplate,
  );
  fastify.put(
    "/mail/templates/:id",
    { preHandler: verifyJwt },
    updateEmailTemplate,
  );
  fastify.delete(
    "/mail/templates/:id",
    { preHandler: verifyJwt },
    deleteEmailTemplate,
  );

  // ============================================================
  // 🔹 INTEGRATION STATUS
  // ============================================================
  fastify.get(
    "/integrationStatus",
    { preHandler: verifyJwt },
    getIntegrationStatus,
  );

  // ============================================================
  // 📞 PHONE IVR
  // ============================================================
  fastify.get("/phone-ivr/account", { preHandler: verifyJwt }, getPhoneAccount);
  fastify.post("/phone-ivr/account", { preHandler: verifyJwt }, upsertPhoneAccount);
  fastify.delete("/phone-ivr/account", { preHandler: verifyJwt }, deletePhoneAccount);

  fastify.get("/phone-ivr/dids", { preHandler: verifyJwt }, getDids);
  fastify.post("/phone-ivr/dids", { preHandler: verifyJwt }, createDid);
  fastify.delete("/phone-ivr/dids/:id", { preHandler: verifyJwt }, deleteDid);

  fastify.get("/phone-ivr/calls", { preHandler: verifyJwt }, getCalls);
  fastify.post("/phone-ivr/calls", { preHandler: verifyJwt }, logCall);
  fastify.patch("/phone-ivr/calls/:uuid", { preHandler: verifyJwt }, updateCall);
  fastify.get("/phone-ivr/calls/stats", { preHandler: verifyJwt }, getCallStats);
  fastify.get("/phone-ivr/calls/lead/:leadId", { preHandler: verifyJwt }, getCallsByLead);

  fastify.get("/phone-ivr/queues", { preHandler: verifyJwt }, getQueues);
  fastify.post("/phone-ivr/queues", { preHandler: verifyJwt }, createQueue);

  fastify.get("/phone-ivr/extensions", { preHandler: verifyJwt }, getExtensions);
  fastify.post("/phone-ivr/extensions", { preHandler: verifyJwt }, createExtension);

  fastify.get("/phone-ivr/ivr-menus", { preHandler: verifyJwt }, getIvrMenus);
  fastify.post("/phone-ivr/ivr-menus", { preHandler: verifyJwt }, createIvrMenu);

  fastify.get("/phone-ivr/voicemails", { preHandler: verifyJwt }, getVoicemails);
  fastify.patch("/phone-ivr/voicemails/:id/read", { preHandler: verifyJwt }, markVoicemailRead);

  // ── AI Calling ───────────────────────────────────────────────
  fastify.get(   "/phone-ivr/ai/credentials",                    { preHandler: verifyJwt }, getAiCredentials);
  fastify.post(  "/phone-ivr/ai/credentials",                    { preHandler: verifyJwt }, upsertAiCredentials);
  fastify.delete("/phone-ivr/ai/credentials/:provider",          { preHandler: verifyJwt }, deleteAiCredentials);

  fastify.get(   "/phone-ivr/ai/templates",                      { preHandler: verifyJwt }, listAiTemplates);
  fastify.post(  "/phone-ivr/ai/templates",                      { preHandler: verifyJwt }, createAiTemplate);
  fastify.put(   "/phone-ivr/ai/templates/:id",                  { preHandler: verifyJwt }, updateAiTemplate);
  fastify.delete("/phone-ivr/ai/templates/:id",                  { preHandler: verifyJwt }, deleteAiTemplate);

  fastify.get(   "/phone-ivr/ai/campaigns",                      { preHandler: verifyJwt }, listAiCampaigns);
  fastify.post(  "/phone-ivr/ai/campaigns",                      { preHandler: verifyJwt }, createAiCampaign);
  fastify.get(   "/phone-ivr/ai/campaigns/:requestId/details",   { preHandler: verifyJwt }, getAiCampaignDetails);
  fastify.patch( "/phone-ivr/ai/campaigns/:requestId/status",    { preHandler: verifyJwt }, updateAiCampaignStatus);
  fastify.delete("/phone-ivr/ai/campaigns/:requestId",           { preHandler: verifyJwt }, deleteAiCampaign);
  // Worker / AGI callbacks — no verifyJwt (called by server-side processes)
  fastify.patch( "/phone-ivr/ai/calls/:id/result",               updateCallResult);
  fastify.post(  "/phone-ivr/ai/calls/:id/recording",            uploadCallRecording);
  fastify.patch( "/phone-ivr/ai/calls/:id/voicemail",            markVoicemail);
  fastify.post(  "/phone-ivr/ai/conversation/turn",              conversationTurn);
  fastify.get(   "/phone-ivr/ai/calls/:id/logs", { preHandler: verifyJwt }, getCallLogs);

  // Audio file server — no auth, Asterisk fetches TTS WAVs from here
  // Filename strictly validated: only ai_*.wav allowed
  fastify.get("/phone-ivr/ai/audio/:filename", async (req: any, reply: any) => {
    const { filename } = req.params as { filename: string };
    if (!/^ai_[a-zA-Z0-9_-]+\.wav$/.test(filename)) {
      return reply.status(404).send();
    }
    const { createReadStream, existsSync } = await import("fs");
    const path = `/tmp/${filename}`;
    if (!existsSync(path)) return reply.status(404).send();
    reply.type("audio/wav");
    return reply.send(createReadStream(path));
  });

  fastify.get(
    "/syncWhatsappTemplates",
    { preHandler: verifyJwt },
    syncWhatsappTemplates,
  );
  fastify.get<{ Querystring: TemplateQuery }>(
    "/whatsappTemplates",
    { preHandler: verifyJwt },
    getWhatsappTemplates,
  );
  fastify.post(
    "/whatsapp/templates",
    { preHandler: verifyJwt },
    createWhatsappTemplate,
  );
  fastify.get(
    "/whatsappProfile",
    { preHandler: verifyJwt },
    getWhatsappProfile,
  );
  fastify.get(
    "/whatsappFlows",
    { preHandler: verifyJwt },
    listWhatsappFlows,
  );
  fastify.post<{ Body: CreateFlowBody }>(
    "/whatsappFlows",
    { preHandler: verifyJwt },
    createWhatsappFlow,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 REFERECE TOKEN GENERATE  ROUTE
  // ───────────────────────────────────────────────────────────
  fastify.post("/refreshAccessToken", refreshAccessToken);

  // ───────────────────────────────────────────────────────────
  //  🔐  GET LEADS  ROUTE
  // ───────────────────────────────────────────────────────────
  fastify.get<{ Querystring: LeadsQuery }>(
    "/getLeads",
    { preHandler: verifyJwt },
    getLeads,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐  CREATE LEAD  ROUTE
  // ───────────────────────────────────────────────────────────
  fastify.post("/createLead", { preHandler: verifyJwt }, createLead);

  // ───────────────────────────────────────────────────────────
  //  🔐  UPDATE LEAD  ROUTE
  // ───────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string }; Body: any }>(
    "/leads/:id",
    { preHandler: verifyJwt },
    updateLead as any,
  );

  fastify.get<{ Params: { id: string } }>(
    "/leads/:id",
    { preHandler: verifyJwt },
    getLeadById,
  );
  fastify.post("/leads-capture", captureLeadByGoogle);
  fastify.post("/sendSmsOtpForLead", sendSmsOtpForLead);
  fastify.post("/verifySmsOtpForLead", verifySmsOtpForLead);
  // fastify.post("/meta/forms", { preHandler: verifyJwt }, createMetaForm);

  // ───────────────────────────────────────────────────────────
  //  🔐  GENERATE MASTER PASSWORD  ROUTE
  // ───────────────────────────────────────────────────────────

  fastify.post(
    "/generateMasterPassword",
    { preHandler: verifyJwt },
    generateMasterPassword,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐  AGENTS   ROUTE
  // ───────────────────────────────────────────────────────────

  fastify.get("/getagents", { preHandler: verifyJwt }, getAgents);

  // update agents details
  fastify.put("/updateagents/:id", { preHandler: verifyJwt }, updateLeadAgents);

  // ───────────────────────────────────────────────────────────
  //  🔐  FOLLOW-UP ROUTES
  // ───────────────────────────────────────────────────────────

  // Schedule a follow-up
  fastify.post<{ Body: any }>(
    "/followups",
    { preHandler: verifyJwt },
    scheduleFollowUp as any,
  );

  // Get follow-ups for a lead
  fastify.get<{ 
    Params: { leadId: string };
    Querystring: { page?: string; limit?: string };
  }>(
    "/leads/:leadId/followups",
    { preHandler: verifyJwt },
    getLeadFollowUps,
  );

  // Update a follow-up
  fastify.put<{ Params: { id: string }; Body: any }>(
    "/followups/:id",
    { preHandler: verifyJwt },
    updateFollowUp as any,
  );

  // Get lead activities (timeline)
  fastify.get<{
    Params: { leadId: string };
    Querystring: { page?: string; limit?: string };
  }>("/leads/:leadId/activities", { preHandler: verifyJwt }, getLeadActivities);

  // Get lead communication data
  fastify.get<{ 
    Params: { leadId: string };
    Querystring: { page?: string; limit?: string };
  }>(
    "/leads/:leadId/communication",
    { preHandler: verifyJwt },
    getLeadCommunication,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 DASHBOARD API  ROUTES
  // ───────────────────────────────────────────────────────────

  fastify.get("/agentdashboard", { preHandler: verifyJwt }, agentdashboard);

  // Alternative route with capital D for compatibility
  fastify.get("/agentDashboard", { preHandler: verifyJwt }, agentdashboard);

  fastify.get(
    "/getadmindashboard",
    { preHandler: verifyJwt },
    getadmindashboard,
  );

  // GET leads dashboard: latest 5, channel counts, weekday-by-source, received/qualified, pagination, search, date range
  fastify.get<{ Querystring: GetLeadsDashboardQuery }>(
    "/getLeadsDashboard",
    { preHandler: verifyJwt },
    getLeadsDashboard,
  );

  // GET agent management dashboard: agent list, leads stats, active/inactive counts, pagination

  fastify.get<{ Querystring: GetLeadsDashboardQuery }>(
    "/getAgentManagementDashboard",
    { preHandler: verifyJwt },
    getAgentManagementDashboard,
  );

  // Alternative route for frontend compatibility
  fastify.get<{ Querystring: GetLeadsDashboardQuery }>(
    "/agentManagementDashboard",
    { preHandler: verifyJwt },
    getAgentManagementDashboard,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 REPORTS API ROUTES (SOURCE ATTRIBUTION & CONVERSION)
  // ───────────────────────────────────────────────────────────

  // GET source attribution report: leads count and conversion rates by source
  fastify.get<{ Querystring: SourceAttributionQuery }>(
    "/reports/source-attribution",
    { preHandler: verifyJwt },
    getSourceAttributionReport,
  );

  // GET detailed conversion statistics by source and stage
  fastify.get<{ Querystring: SourceAttributionQuery }>(
    "/reports/conversion-stats",
    { preHandler: verifyJwt },
    getConversionStatsBySource,
  );

  // GET pipeline health: leads count by status
  fastify.get<{ Querystring: SourceAttributionQuery }>(
    "/reports/pipeline-health",
    { preHandler: verifyJwt },
    getPipelineHealth,
  );

  // GET team productivity: leads assigned and closed by agent
  fastify.get<{ Querystring: SourceAttributionQuery }>(
    "/reports/team-productivity",
    { preHandler: verifyJwt },
    getTeamProductivity,
  );

  // Full leads report (with CSV export via ?format=csv)
  fastify.get(
    "/reports/leads",
    { preHandler: verifyJwt },
    getLeadsReport as any,
  );
  // Follow-ups report
  fastify.get(
    "/reports/followups",
    { preHandler: verifyJwt },
    getFollowupsReport as any,
  );
  // Lead activities report
  fastify.get(
    "/reports/activities",
    { preHandler: verifyJwt },
    getActivitiesReport as any,
  );
  // Conversations/inbox report
  fastify.get(
    "/reports/conversations",
    { preHandler: verifyJwt },
    getConversationsReport as any,
  );
  // Daily summary (leads + messages per day)
  fastify.get(
    "/reports/daily-summary",
    { preHandler: verifyJwt },
    getDailySummary as any,
  );
  // Lead ageing — stale/uncontacted leads bucketed by days
  fastify.get(
    "/reports/lead-ageing",
    { preHandler: verifyJwt },
    getLeadAgeing as any,
  );
  // Campaign / UTM attribution
  fastify.get(
    "/reports/campaign-attribution",
    { preHandler: verifyJwt },
    getCampaignAttribution as any,
  );
  // Hot leads — high-score unconverted
  fastify.get(
    "/reports/hot-leads",
    { preHandler: verifyJwt },
    getHotLeads as any,
  );
  // Unassigned leads — no agent yet
  fastify.get(
    "/reports/unassigned-leads",
    { preHandler: verifyJwt },
    getUnassignedLeads as any,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 ANALYTICS API ROUTES
  // ───────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/overview",
    { preHandler: verifyJwt },
    getAnalyticsOverview as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/messages-trend",
    { preHandler: verifyJwt },
    getMessagesTrend as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/channel-breakdown",
    { preHandler: verifyJwt },
    getChannelBreakdown as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/lead-funnel",
    { preHandler: verifyJwt },
    getLeadFunnel as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/lead-score-distribution",
    { preHandler: verifyJwt },
    getLeadScoreDistribution as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/conversation-status",
    { preHandler: verifyJwt },
    getConversationStatus as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/agent-performance",
    { preHandler: verifyJwt },
    getAgentPerformance as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/leads-trend",
    { preHandler: verifyJwt },
    getLeadsTrend as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/lead-source-performance",
    { preHandler: verifyJwt },
    getLeadSourcePerformance as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/message-type-breakdown",
    { preHandler: verifyJwt },
    getMessageTypeBreakdown as any,
  );
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/analytics/hourly-activity",
    { preHandler: verifyJwt },
    getHourlyActivity as any,
  );
  fastify.get<{ Querystring: { limit?: string } }>(
    "/analytics/recent-activity",
    { preHandler: verifyJwt },
    getRecentActivity as any,
  );

  // ───────────────────────────────────────────────────────────
  //  🔐 TEMPLATE API ROUTES
  // ───────────────────────────────────────────────────────────

  // Create SMS template
  fastify.post("/createTemplate", { preHandler: verifyJwt }, createTemplate);

  // Get all templates for user
  fastify.get("/templates", { preHandler: verifyJwt }, getTemplates);

  // Get single template
  fastify.get("/templates/:id", { preHandler: verifyJwt }, getTemplate);

  // Update template
  fastify.put("/templates/:id", { preHandler: verifyJwt }, updateTemplate);

  // Delete template
  fastify.delete("/templates/:id", { preHandler: verifyJwt }, deleteTemplate);

  // ───────────────────────────────────────────────────────────
  // 🔹 SENDER ID MANAGEMENT
  // ───────────────────────────────────────────────────────────

  // Create Sender ID
  fastify.post("/senderIds", { preHandler: verifyJwt }, createSenderId);

  // Get all Sender IDs for user
  fastify.get("/senderIds", { preHandler: verifyJwt }, getSenderIds);

  // Get single Sender ID
  fastify.get("/senderIds/:id", { preHandler: verifyJwt }, getSenderId);

  // Update Sender ID
  fastify.put("/senderIds/:id", { preHandler: verifyJwt }, updateSenderId);

  // Delete Sender ID
  fastify.delete("/senderIds/:id", { preHandler: verifyJwt }, deleteSenderId);

  // Make Sender ID Default
  fastify.patch(
    "/senderIds/:id/make-default",
    { preHandler: verifyJwt },
    makeDefaultSenderId,
  );

  // Remove Default Status from Sender ID
  fastify.patch(
    "/senderIds/:id/remove-default",
    { preHandler: verifyJwt },
    removeDefaultSenderId,
  );

  // Download Sender IDs CSV
  fastify.get(
    "/senderIds/export/csv",
    { preHandler: verifyJwt },
    downloadSenderIdsCSV,
  );

  // ───────────────────────────────────────────────────────────
  // 🔹 TEAM MANAGEMENT
  // ───────────────────────────────────────────────────────────
  fastify.get("/teams",                                       { preHandler: verifyJwt }, getTeams);
  fastify.post("/teams",                                      { preHandler: verifyJwt }, createTeam);
  fastify.put("/teams/:team_id",                              { preHandler: verifyJwt }, updateTeam);
  fastify.delete("/teams/:team_id",                           { preHandler: verifyJwt }, deleteTeam);
  fastify.get("/teams/:team_id/members",                      { preHandler: verifyJwt }, getTeamMembers);
  fastify.post("/teams/:team_id/members",                     { preHandler: verifyJwt }, addTeamMember);
  fastify.delete("/teams/:team_id/members/:agent_username",   { preHandler: verifyJwt }, removeTeamMember);

  // ───────────────────────────────────────────────────────────
  // 🔹 WORKFLOW
  // ───────────────────────────────────────────────────────────

  fastify.post(
    "/workflows",
    {
      schema: createWorkflowSchema,
      preHandler: verifyJwt,
    },
    createWorkflowController,
  );

  // list workflows
  fastify.get(
    "/workflows",
    {
      schema: getWorkflowsSchema,
      preHandler: verifyJwt,
    },
    getWorkflowsController,
  );

  fastify.get(
    "/workflows/:id/canvas",
    { preHandler: verifyJwt },
    getWorkflowCanvasController,
  );

  fastify.post(
    "/workflows/:id/canvas",
    { preHandler: verifyJwt },
    saveWorkflowCanvasController,
  );

  fastify.patch(
    "/workflows/:id/status",
    { preHandler: verifyJwt },
    updateWorkflowStatusController,
  );

  fastify.delete(
    "/workflows/:id",
    { preHandler: verifyJwt },
    deleteWorkflowController,
  );

  fastify.post(
    "/workflows/:id/duplicate",
    { preHandler: verifyJwt },
    duplicateWorkflowController,
  );

  // ── Automations ──────────────────────────────────────────────────────────────
  fastify.post("/automations",              { preHandler: verifyJwt }, createAutomationController);
  fastify.get( "/automations",              { preHandler: verifyJwt }, getAutomationsController);
  fastify.get( "/automations/logs",         { preHandler: verifyJwt }, getAutomationLogsController);
  fastify.get( "/automations/:id",          { preHandler: verifyJwt }, getAutomationController);
  fastify.put( "/automations/:id",          { preHandler: verifyJwt }, updateAutomationController);
  fastify.patch("/automations/:id/status",  { preHandler: verifyJwt }, updateAutomationStatusController);
  fastify.delete("/automations/:id",        { preHandler: verifyJwt }, deleteAutomationController);
  fastify.post( "/automations/:id/duplicate",{ preHandler: verifyJwt }, duplicateAutomationController);

  // pipeline API's
  // GET /api/pipelineLeads - Get pipeline leads data with specific fields
  fastify.get("/pipelineLeads", { preHandler: verifyJwt }, getPipelineLeads);
  fastify.get("/pipelineLeads/focus", { preHandler: verifyJwt }, getFocusDeals);

  fastify.get(
    "/permissions",
    { preHandler: verifyJwt },
    getCurrentUserPermissions,
  );

  fastify.get("/sidebar", { preHandler: verifyJwt }, getSidebarConfig);
}
