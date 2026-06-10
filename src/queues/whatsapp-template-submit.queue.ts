import { Queue } from "bullmq";
import { redisConnection } from "./campaign.queue.js";

export interface WhatsappTemplateSubmitJobData {
  templateId: number;
  username:   string;
}

export const whatsappTemplateSubmitQueue = new Queue<WhatsappTemplateSubmitJobData>(
  "whatsapp-template-submit",
  {
    connection: redisConnection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail:     { count: 500 },
    },
  },
);
