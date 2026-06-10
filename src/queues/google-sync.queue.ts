import { Queue } from "bullmq";
import { redisConnection } from "./campaign.queue.js";

export interface GoogleSyncJobData {
  username: string;
}

export const googleSyncQueue = new Queue<GoogleSyncJobData>("google-ads-sync", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 200 },
    removeOnFail:    { count: 200 },
  },
});
