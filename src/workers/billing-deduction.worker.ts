import { Worker, Job } from "bullmq";
import { redisConnection } from "../queues/campaign.queue.js";
import { BillingDeductionJobData } from "../queues/billing-deduction.queue.js";
import { processDeliveryDeduction } from "../modules/billing/services/billing.service.js";
import { db } from "../models/db.js";

export function startBillingDeductionWorker() {
  const worker = new Worker<BillingDeductionJobData>(
    "billing-deduction",
    async (job: Job<BillingDeductionJobData>) => {
      const { txnId, username, channel, category, refId, refTable, deliveryStatus } = job.data;

      try {
        await processDeliveryDeduction(
          txnId,
          username,
          channel as any,
          category ?? "",
          refId,
          refTable,
          deliveryStatus,
        );
      } catch (err: any) {
        // Increment retry_count and store last error
        await (db as any)
          .updateTable("billing_deduction_queue")
          .set({
            retry_count:   job.attemptsMade,
            error_message: String(err?.message ?? err).slice(0, 1000),
          })
          .where("txn_id", "=", txnId)
          .execute();

        throw err; // let BullMQ retry
      }
    },
    {
      connection:  redisConnection as any,
      concurrency: 10,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[billing-deduction] Job ${job.id} completed — txn_id=${job.data.txnId}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[billing-deduction] Job ${job?.id} failed — txn_id=${job?.data?.txnId}`, err.message);
  });

  return worker;
}
