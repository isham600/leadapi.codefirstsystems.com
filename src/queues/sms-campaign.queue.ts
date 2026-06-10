import { Queue }  from "bullmq";
import { redisConnection } from "./campaign.queue.js";   // reuse shared Redis connection

// Each job = one chunk of receivers to insert into smpp_campaign_details
export const smsCampaignInsertQueue = new Queue("sms-campaign-insert", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail:     { count: 1000 },
  },
});
