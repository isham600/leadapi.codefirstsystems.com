import { Queue } from "bullmq";
import { redisConnection } from "./campaign.queue.js";

export interface BillingDeductionJobData {
  txnId:          string;   // idempotency key
  username:       string;
  channel:        string;
  category:       string | null;
  refId:          string;
  refTable:       string;
  deliveryStatus: string;
}

export const billingDeductionQueue = new Queue<BillingDeductionJobData>(
  "billing-deduction",
  {
    connection: redisConnection as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: { count: 1000 },
      removeOnFail:     { count: 500 },
    },
  },
);
