export interface CiAdminShubham {
  admin_id: number;
  admin_role_id: number;
  username: string | null;
  usertype: string | null;
  whatsapp: string | null;
  whatsapp_credits: string | null;
  sms: string | null;
  sms_credits: string | null;
  voice_credits: string | null;
  email_credits: string | null;
  email_bulk: string | null;
  api_credits: string | null;
  gsm_credits: string | null;
  whatsapp_virtual_credits: string | null;
  sms_virtual_credits: string | null;
  overseas_credits: string;
  misscall: string | null;
  misscall_credits: string | null;
  voice: string | null;
  api_whatsapp: string | null;
  gsm: string | null;
  whatsapp_virtual: string | null;
  sms_virtual: string | null;
  overseas_sms: string | null;
  chat: string | null;
  country: string | null;
  firstname: string | null;
  lastname: string | null;
  password: string | null;
  email: string | null;
  mobile_no: string | null;
  msgtype: string | null;
  senderid: string | null;
  dummy_credits: string | null;
  txt_balance: string | null;
  route: string | null;
  status: string | null;
  Reseller: string;
  MasterReseller: string | null;
  delivery_type: string | null;
  ndncstatus: string | null;
  dummy_credits_api: string | null;
  api_user: string | null;
  api_status: string | null;
  expiry: string | null;
  authkey: string | null;
  authkey1: string | null;
  last_login: Date;
  is_verify: number;
  is_admin: number;
  is_active: number;
  is_super: number;
  token: string;
  password_reset_code: string;
  last_ip: string;
  created_at: Date;
  updated_at: Date;
  serss: number;
  is_notify_visible: number;
}

//schema for permissions table
export interface Permission {
  // id: number;
  username: string; // signup user ka username
  uuid: string; // user uuid
  create_client: number; // 0 or 1
  view_leads: number; // 0 or 1
  edit_leads: number; // 0 or 1
  manage_users: number; // 0 or 1
  view_reports: number; // 0 or 1
  manage_automations: number; // 0 or 1
  billing_access: number; // 0 or 1
  team: string | null; // team name (optional)

  can_create_reseller: number;

  // Sidebar permissions
  sidebar_dashboard: number;
  sidebar_lead_manager: number;
  sidebar_pipeline: number;
  sidebar_inbox: number;
  sidebar_lead_capture: number;
  sidebar_workflows: number;
  sidebar_automations: number;
  sidebar_integrations: number;
  sidebar_webhooks: number;
  sidebar_app_marketing: number;
  sidebar_analytics: number;
  sidebar_reports: number;
  sidebar_billing: number;
  sidebar_api_docs: number;
  sidebar_settings: number;
  sidebar_user_management: number;

  // Lead Channel permissions
  channel_whatsapp: number;
  channel_sms: number;
  channel_rcs: number;
  channel_email: number;
  channel_voice: number;
  channel_ai_calling: number;
  channel_meta_ads: number;
  channel_google_ads: number;

  // Integration permissions
  integration_whatsapp: number;
  integration_sms: number;
  integration_rcs: number;
  integration_email: number;
  integration_voice: number;
  integration_meta_ads: number;
  integration_google_ads: number;

  created_at: Date;
  updated_at: Date;
}

// schema for dual verification
export interface DualVerification {
  // id: number;                     // AUTO_INCREMENT primary key
  uuid: string; // varchar(100)
  username: string; // varchar(255)

  session_id: string; // varchar(100)
  session_expire_at: Date; // datetime

  method: "mobile" | "email" | "qa" | null; // enum

  api_response?: string | null; // longtext nullable
  payload?: string | null; // longtext nullable

  phone?: string | null; // varchar(20)
  email?: string | null; // varchar(255)

  otp?: string | null; // varchar(10)
  otp_expire?: Date | null; // datetime

  question?: string | null; // varchar(255)
  answer_hash?: string | null; // varchar(255)
  dual_verification_type: "sms_otp" | "email_otp" | "qa"; // enum

  status: "pending" | "verified" | "expired"; // enum default pending
  is_verified: 0;

  created_at?: Date; // datetime default current_timestamp()
  updated_at?: Date | null; // datetime
}

// schema for question table
export interface QuestionTable {
  // id: number;
  question_text: string;
  is_active: number;
  created_at: Date;
  updated_at: Date;
}

export interface SmppGateway {
  id: number;
  username: string;
  gateway_name: string;
  ip_address: string;
  system_id: string;
  password: string;
  status: "active" | "inactive";
  connection_mode: "transmitter" | "receiver" | "transceiver";
  max_tps: number;
  priority: number;
  created_at: Date;
  updated_at: Date;
  channel: "promotional" | "transactional";
  tx_sessions: number;
  rx_sessions: number;
  txrx_sessions: number;
  tx_port: number;
  rx_port: number;
  txrx_port: number;
  address_npi: number;
  address_ton: number;
  async_mode: number;
  keep_alive_interval: number;
  system_type: string;
  gateway_open_time: string;
  gateway_close_time: string;
  interface_version: string;
  window_size: number;
  gsm_encoding: string;
  enabled_template_dlt: number;
  telemarketer_id: string;
  is_hash_gateway: number;
  connection_state: "CONNECTED" | "DISCONNECTED" | "CONNECTING";
  last_state_change: Date | null;
}

export interface smtpTemplates {
  id: number;
  username: string;
  template_name: string;
  message: string;
  teid: string;
  status: number; // 0 = pending, 1 = approved, 2 = rejected
  create_at: Date;
  update_at: Date;
}

export interface ActivityLog {
  // id: number;
  username?: string | null;
  action: string;
  description?: string | null;
  ip_address?: string | null;
  uuid?: string | null;
  device_info?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface LeadFollowUp {
  id?: number;
  tenant_id?: string | null;
  login_username?: string | null;
  lead_id: number;
  lead_name: string;
  scheduled_at: Date;
  notes?: string | null;
  status: string; // pending | completed | cancelled
  completed_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface LeadActivity {
  id?: number;
  tenant_id?: string | null;
  login_username?: string | null;
  login_user_type?: number | null;
  lead_name: string;
  lead_id: number;
  activity_type: string; // CALL | EMAIL | WHATSAPP | SMS | FOLLOWUP
  action: string; // CALL_MADE | MESSAGE_SENT | EMAIL_SENT | FOLLOWUP_SCHEDULED | FOLLOWUP_COMPLETED
  status: string; // answered | missed | sent | delivered | read | failed | pending | completed
  source: string; // inbound | outbound | system | webhook
  description?: string | null;
  duration_seconds?: number | null;
  direction?: string | null; // inbound | outbound
  channel?: string | null; // telephonic | whatsapp | email | sms
  metadata?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface WebhookLog {
  id?: number;
  uuid: string;
  username: string;
  channel: string;
  payload: string;
  headers?: string | null;
  ip_address?: string | null;
  status: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface ChatMessage {
  id?: number;
  uuid: string;
  username: string;
  channel: string;
  conversation_id?: string | null;
  message_id?: string | null;
  context_message_id?: string | null;
  sender_id: string;
  receiver_id: string;
  contact_name?: string | null;
  type: string;
  text?: string | null;
  media_url?: string | null;
  media_id?: string | null;
  media_mime?: string | null;
  media_filename?: string | null;
  media_size_bytes?: number | null;
  reaction_emoji?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_name?: string | null;
  template_name?: string | null;
  template_lang?: string | null;
  direction: string;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
  platform_timestamp?: number | null;
  phone_number_id?: string | null;
  waba_id?: string | null;
  pricing_category?: string | null;
  metadata?: string | null;
  raw_payload?: string | null;
  is_deleted?: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface ChatMessageSummary {
  id?: number;
  uuid: string;
  username: string;
  conversation_id: string;
  channel: string;
  sender_id: string;
  receiver_id: string;
  contact_name?: string | null;
  last_message?: string | null;
  last_message_type?: string | null;
  last_message_at?: Date | null;
  last_message_dir?: string | null;
  session_message_time?: Date | null; // last inbound msg time — Meta 24h session window
  is_read: number;
  unread_count: number;
  is_starred: number;
  conv_status: string;
  assigned_to?: string | null;
  assigned_at?: Date | null;
  resolved_at?: Date | null;
  tags?: string | null;
  notes?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface BlacklistNumber {
  id?: number;
  uuid: string;
  username: string;
  phone_number: string;
  channel: string;
  reason?: string | null;
  is_active: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface WebhookForwardUrl {
  id?: number;
  uuid: string;
  username: string;
  url: string;
  channel: string;
  status: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface WebhookOutboundLog {
  id?: number;
  uuid: string;
  username: string;
  channel: string;
  forward_url: string;
  request_payload?: string | null;
  response_body?: string | null;
  http_status?: number | null;
  success: number;
  error_message?: string | null;
  created_at?: Date;
}

export interface WebhookChannelSetting {
  id?: number;
  username: string;
  uuid: string;
  channel: string;
  verify_token_enabled: number;  // 0 | 1
  verify_token?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface Lead {
  id?: number;
  username: string;
  tenant_id?: string | null;
  first_name: string;
  last_name?: string | null;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  country_code?: string | null;
  city?: string | null;
  status: string; // New | Contacted | Qualified | …
  lifecycle?: string | null; // lead | prospect | customer
  priority?: string | null; // Low | Medium | High
  source?: string | null; // whatsapp | facebook | google | manual …
  sub_source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  term?: string | null;
  content?: string | null;
  gclid?: string | null;
  landing_page?: string | null;
  lead_score: number;
  lead_value?: number | null; // Monetary value of the lead
  close_date?: Date | null; // Expected close date
  owner_id?: string | null;
  team_id?: string | null;
  assigned_agent?: string | null;
  user_type?: string | null;
  first_contacted_at?: Date | null;
  last_contacted_at?: Date | null;
  last_activity_at?: Date | null;
  next_followup_at?: Date | null;
  is_duplicate: number;
  is_converted: number;
  is_archived: number;
  created_by?: string | null;
  updated_by?: string | null;
  meta_form_id?: string | null;
  meta_lead_id?: string | null;
  raw_payload?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface Team {
  id?: number;
  team_id: string;
  username: string;
  name: string;
  description?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface TeamMember {
  id?: number;
  team_id: string;
  owner_username: string;
  agent_username: string;
  created_at?: Date;
}

export interface ChatbotFlow {
  id?: number;
  uuid: string;
  username: string;
  flow_name: string;
  trigger_keywords?: string | null;
  trigger_type?: string | null;       // keyword | first_message | postback | opt_out | always
  trigger_channels?: string | null;   // comma-separated: whatsapp,rcs,facebook — null = all
  is_default: number;
  is_active: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface ChatbotFlowStep {
  id?: number;
  flow_id: number;
  uuid: string;
  step_order: number;
  step_type: "message" | "question" | "end" | "condition" | "delay" | "transfer_to_agent" | "set_field" | "webhook";
  message: string;
  variable_name?: string | null;
  options_json?: string | null;       // JSON config for condition/delay/transfer/set_field/webhook steps
  created_at?: Date;
  updated_at?: Date;
}

export interface ChatbotSession {
  id?: number;
  uuid: string;
  username: string;
  conversation_id: string;
  sender_id: string;
  flow_id: number;
  current_step_id?: number | null;
  waiting_for_input: number;
  collected_data?: string | null;
  status: "active" | "completed";
  created_at?: Date;
  updated_at?: Date;
}

export interface DB {
  ci_admin_shubham: CiAdminShubham;
  users: any;
  session_login: any;
  smsapiparams: any;
  login_otp_logs: any;
  smtpmailotp: any;
  reset_password: any;
  permissions: Permission;
  dual_verification_logs: DualVerification;
  question_table: QuestionTable;
  activity_log: ActivityLog;
  whatsapp_accounts: any;
  rcs_accounts: any;
  funds_management: any;
  webhook_logs: any;
  webhook_inbound_logs: WebhookLog;
  leads: Lead;
  forms: any;
  lead_history: any;
  lead_activities: LeadActivity;
  lead_followups: LeadFollowUp;
  google_url: any;
  base_url_for_intrigation: any;
  webhook: any;
  master_passwords: any;
  meta_integrations: any;
  meta_accounts: any;
  smtpmailotp_accounts: any;
  google_ads_integrations: any;
  smpp_gateways: SmppGateway;
  smpp_templates: smtpTemplates;
  chat_messages: ChatMessage;
  chat_message_summary: ChatMessageSummary;
  blacklist_numbers: BlacklistNumber;
  webhook_forward_urls: WebhookForwardUrl;
  webhook_outbound_logs: WebhookOutboundLog;
  webhook_channel_settings: WebhookChannelSetting;
  teams: Team;
  team_members: TeamMember;
  chatbot_flows: ChatbotFlow;
  chatbot_flow_steps: ChatbotFlowStep;
  chatbot_sessions: ChatbotSession;
  chatbot_summary: ChatbotSummary;
  chatbot_detail: ChatbotDetail;
  automation_summary: AutomationSummary;
  automation_logs: AutomationLog;
  notifications: AppNotification;
  notification_prefs: NotificationPrefs;
  rcs_templates: RcsTemplate;
  rcs_camp_summary: RcsCampSummary;
  rcs_camp_details: RcsCampDetail;
  wallets: Wallet;
  wallet_transactions: WalletTransaction;
  pricing_profiles: PricingProfile;
  voice_slab_pricing: VoiceSlabPricing;
  billing_deduction_queue: BillingDeductionQueue;
  web_forms: WebForm;
  form_submissions: FormSubmission;
  whatsapp_phone_numbers: WhatsappPhoneNumber;
}

export interface AppNotification {
  id?: number;
  username: string;
  type: string; // new_lead | status_change | new_message | followup_due | overdue | assigned
  title: string;
  description?: string | null;
  link?: string | null;
  read_at?: Date | null;
  created_at?: Date;
}

export interface NotificationPrefs {
  id?: number;
  username: string;
  email_new_lead?: number; // tinyint 0/1
  email_daily_digest?: number;
  email_weekly_report?: number;
  email_status_change?: number;
  inapp_new_lead?: number;
  inapp_status_change?: number;
  inapp_new_message?: number;
  inapp_followup_due?: number;
  inapp_overdue?: number;
  inapp_pipeline?: number;
  inapp_automation_fail?: number;
  push_urgent?: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface ChatbotSummary {
  id?: number;
  username: string;
  name: string;
  description?: string | null;
  source?: string | null;
  trigger_event?: string | null;
  status?: string | null;
  runs?: number | null;
  last_run?: Date | null;
  created_at?: Date;
}

export interface ChatbotDetail {
  id?: number;
  chatbot_id: number;
  username: string;
  nodes: string;
  edges: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface RcsTemplate {
  id?: number;
  username: string;
  name: string;
  message_type: string; // text | rich_card | carousel
  body_text?: string | null;
  rich_card_json?: string | null;
  carousel_cards_json?: string | null;
  suggested_replies_json?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface RcsCampSummary {
  id?: number;
  username: string;
  name: string;
  template_id: number;
  template_name: string;
  audience: number;
  sent?: number;
  delivered?: number;
  read_count?: number;
  status: string; // pending | scheduled | active | completed | failed
  sms_fallback?: number; // tinyint 0/1
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface RcsCampDetail {
  id?: number;
  camp_id: number;
  username: string;
  phone_number: string;
  status?: string; // pending | sent | delivered | read | failed
  sent_at?: Date | null;
  delivered_at?: Date | null;
  read_at?: Date | null;
  error?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface AutomationSummary {
  id?: number;
  username: string;
  name: string;
  description?: string | null;
  source: string;
  trigger_event: string;
  trigger_type: string; // event | time | webhook | db-change | external | keyword | button_reply | first_message | no_reply | session_expiry | opt_out | missed_call
  keyword_match?: string | null; // comma-separated keywords (used when trigger_type = keyword)
  actions_json?: string | null; // JSON array
  status: "active" | "paused" | "draft";
  runs?: number;
  last_run?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface AutomationLog {
  id?: number;
  automation_id: number;
  username: string;
  automation_name: string;
  event: string;
  result: "success" | "failed" | "skipped";
  error_message?: string | null;
  created_at?: Date;
}

// ── Billing System ────────────────────────────────────────────

export interface Wallet {
  id?: number;
  username: string;
  balance: number;
  currency: string;
  is_active: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface WalletTransaction {
  id?: number;
  txn_id: string;
  username: string;
  initiated_by: string;
  type: "topup" | "deduction" | "refund" | "adjustment" | "transfer_out" | "transfer_in";
  channel: "sms" | "whatsapp" | "rcs" | "email" | "voice" | "ai_calling" | "meta_ads" | "wallet";
  category?: string | null;
  amount: number;
  balance_before: number;
  balance_after: number;
  ref_id?: string | null;
  ref_table?: string | null;
  delivery_status?: string | null;
  description?: string | null;
  metadata?: string | null;
  ip_address?: string | null;
  created_at?: Date;
}

export interface PricingProfile {
  id?: number;
  username: string;
  channel: "sms" | "whatsapp" | "rcs" | "email" | "voice" | "ai_calling" | "meta_ads";
  category: string;
  rate_per_unit: number;
  connection_charge: number;
  pulse_seconds: number;
  duration_rate: number;
  ai_processing_cost: number;
  cpc: number;
  cpl: number;
  billing_mode: "submission" | "delivery";
  bill_on_sent: number;
  bill_on_delivered: number;
  bill_on_read: number;
  bill_on_failed: number;
  bill_on_blocked: number;
  refund_on_failed: number;
  refund_on_blocked: number;
  is_active: number;
  created_by: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface VoiceSlabPricing {
  id?: number;
  pricing_profile_id: number;
  slab_order: number;
  duration_from_sec: number;
  duration_to_sec?: number | null;
  rate_per_pulse: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface BillingDeductionQueue {
  id?: number;
  txn_id: string;
  username: string;
  channel: string;
  category?: string | null;
  ref_id: string;
  ref_table: string;
  delivery_status: string;
  processed: number;
  retry_count: number;
  error_message?: string | null;
  created_at?: Date;
  processed_at?: Date | null;
}

export interface WebForm {
  id?: number;
  username: string;
  embed_key: string;
  webhook_url: string;
  form_title?: string | null;
  form_description?: string | null;
  form_fields?: any | null;
  total_submissions?: number;
  total_leads_created?: number;
  allowed_origins?: any | null;
  api_key?: string | null;
  status: "active" | "inactive" | "archived";
  created_at: Date;
  updated_at: Date;
}

export interface FormSubmission {
  id?: number;
  form_id: number;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  custom_fields?: any | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  referrer?: string | null;
  page_url?: string | null;
  lead_id?: number | null;
  conversion_status?: "pending" | "converted" | "failed";
  ip_address?: string | null;
  user_agent?: string | null;
  submitted_at: Date;
  created_at: Date;
}

export interface WhatsappPhoneNumber {
  id?: number;
  waba_account_id: number;
  phone_number_id: string;
  phone_number: string;
  verified_name?: string | null;
  quality_rating?: string | null;
  status?: string | null;
  is_primary?: number;
  messages_sent?: number;
  leads_received?: number;
  last_message_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}
