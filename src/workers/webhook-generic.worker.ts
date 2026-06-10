import { Worker } from "bullmq";
import { redisConnection } from "../queues/campaign.queue.js";
import type { WebhookJobData } from "../queues/webhook.queue.js";
import { forwardToUrls } from "../utils/webhook-processor.js";

// ============================================================
// webhook-generic worker
// Purpose: Forward raw inbound payloads (channel = "webhook")
// to all registered forward URLs for the user.
// No message parsing or DB chat storage — just forward.
// ============================================================
const worker = new Worker<WebhookJobData>(
  "webhook-generic",
  async (job) => {
    const { uuid, username, channel, payload } = job.data;

    console.log(`[webhook-generic] Received | user=${username} channel=${channel}`);

    // Forward payload to all active registered URLs
    await forwardToUrls(uuid, username, channel, payload);

    console.log(`[webhook-generic] Forwarded | user=${username}`);
  },
  { connection: redisConnection as any, concurrency: 20 },
);

worker.on("failed", (job, err) =>
  console.error(`[webhook-generic] Job ${job?.id} failed:`, err.message),
);

export default worker;
