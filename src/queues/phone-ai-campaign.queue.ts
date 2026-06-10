import { Queue } from "bullmq";
import { redisConnection } from "./campaign.queue.js";

// Job data shape — one job per campaign trigger
export interface PhoneAiCampaignJobData {
  requestId: string;
  username:  string;
}

// Queue: each job processes one AI calling campaign
export const phoneAiCampaignQueue = new Queue<PhoneAiCampaignJobData>(
  "phone-ai-campaign",
  {
    connection: redisConnection as any,
    defaultJobOptions: {
      attempts:  3,
      backoff:   { type: "exponential", delay: 10000 },
      removeOnComplete: { count: 200 },
      removeOnFail:     { count: 200 },
    },
  }
);
