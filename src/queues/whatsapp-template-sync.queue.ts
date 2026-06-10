import { Queue } from "bullmq";
import { redisConnection } from "./campaign.queue.js";

export interface WhatsappTemplateSyncJobData {
  username:    string;
  accountId:   number;
  wabaId:      string;
  accessToken: string;
}

export const whatsappTemplateSyncQueue = new Queue<WhatsappTemplateSyncJobData>("whatsapp-template-sync", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 200 },
    removeOnFail:    { count: 200 },
  },
});
