import { Queue } from "bullmq";
import { redisConnection } from "./campaign.queue.js";

export interface WebhookJobData {
  uuid:       string;
  username:   string;
  channel:    string;
  payload:    any;
  headers:    Record<string, string>;
  ip_address: string | null;
  log_id?:    number;
}

const defaultJobOptions = {
  attempts:         3,
  backoff:          { type: "exponential", delay: 5000 },
  removeOnComplete: { count: 200 },
  removeOnFail:     { count: 100 },
};

export const webhookWhatsappQueue = new Queue<WebhookJobData>("webhook-whatsapp", {
  connection: redisConnection as any,
  defaultJobOptions,
});

export const webhookFacebookQueue = new Queue<WebhookJobData>("webhook-facebook", {
  connection: redisConnection as any,
  defaultJobOptions,
});

export const webhookGoogleQueue = new Queue<WebhookJobData>("webhook-google", {
  connection: redisConnection as any,
  defaultJobOptions,
});

export const webhookRcsQueue = new Queue<WebhookJobData>("webhook-rcs", {
  connection: redisConnection as any,
  defaultJobOptions,
});

// Generic webhook forwarding (custom integrations / third-party tools)
export const webhookGenericQueue = new Queue<WebhookJobData>("webhook-generic", {
  connection: redisConnection as any,
  defaultJobOptions,
});

// Chatbot engine dispatcher
export const webhookChatbotQueue = new Queue<WebhookJobData>("webhook-chatbot", {
  connection: redisConnection as any,
  defaultJobOptions,
});

// Lead dispatcher (auto-create / update leads from inbound messages)
export interface LeadJobData {
  uuid:          string;
  username:      string;
  channel:       string;
  phone?:        string | null;
  email?:        string | null;
  contact_name?: string | null;
  country_code?: string | null;
  sub_source?:   string | null;
  city?:         string | null;
}

export const leadDispatcherQueue = new Queue<LeadJobData>("lead-dispatcher", {
  connection: redisConnection as any,
  defaultJobOptions,
});
