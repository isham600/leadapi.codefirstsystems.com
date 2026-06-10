import { Worker } from "bullmq";
import { redisConnection } from "../queues/campaign.queue.js";
import type { LeadJobData } from "../queues/webhook.queue.js";
import { processLeadJob } from "../utils/lead-dispatcher.js";

// ============================================================
// Lead Dispatcher Worker
// Queue: lead-dispatcher
//
// Processes inbound-message events → auto-creates or updates
// lead records in the `leads` table with dedup + score logic.
// ============================================================

const worker = new Worker<LeadJobData>(
  "lead-dispatcher",
  async (job) => {
    const { username, channel, phone, email } = job.data;
    await processLeadJob(job.data);
    console.log(
      `[lead-dispatcher] OK | user=${username} channel=${channel} phone=${phone ?? "-"} email=${email ?? "-"}`,
    );
  },
  {
    connection:  redisConnection as any,
    concurrency: 20,
  },
);

worker.on("failed", (job, err) =>
  console.error(`[lead-dispatcher] Job ${job?.id} failed:`, err.message),
);

export default worker;
