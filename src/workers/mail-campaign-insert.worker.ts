import { Worker, Job } from "bullmq";
import { sql } from "kysely";
import { db } from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";
import {
  mailInsertQueue,
  mailSendQueue,
  type MailInsertJobData,
} from "../queues/mail-campaign.queue.js";

// ── Worker: inserts email rows into mail_camp_details ──────────

async function processInsertJob(
  job: Job<MailInsertJobData>
): Promise<{ inserted: number; errors: number }> {
  const { campaignId, username, chunkIndex, totalChunks, rows } = job.data;

  const now        = new Date();
  let inserted     = 0;
  let errorCount   = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      await (db as any)
        .insertInto("mail_camp_details")
        .values({
          campaign_id:    campaignId,
          username,
          email:          row.email,
          recipient_name: row.recipientName ?? null,
          custom_vars:    Object.keys(row.customVars).length
                            ? JSON.stringify(row.customVars)
                            : null,
          status:         "pp1",
          created_at:     now,
        })
        .execute();

      inserted++;
    } catch (err: any) {
      errorCount++;
      console.error(`[mailInsert] row insert failed email=${row.email}: ${err.message}`);
    }

    if ((i + 1) % 50 === 0) {
      await job.updateProgress(Math.round(((i + 1) / rows.length) * 100));
    }
  }

  // ── Update campaign summary sent_count atomically ─────────
  const isLastChunk = chunkIndex === totalChunks - 1;

  if (isLastChunk) {
    // All chunks done — update status to 'sending' and queue the send job
    await (db as any)
      .updateTable("mail_camp_summary")
      .set({
        status:     "sending",
        updated_at: now,
      })
      .where("campaign_id", "=", campaignId)
      .execute();

    await mailSendQueue.add(
      `send-${campaignId}` as any,
      { campaignId, username },
      { priority: 1 }
    );

    console.log(`[mailInsert] all chunks done for ${campaignId} — send job queued`);
  } else {
    // Intermediate chunk — update status to 'inserting'
    await (db as any)
      .updateTable("mail_camp_summary")
      .set({
        status:     "inserting",
        updated_at: now,
      })
      .where("campaign_id", "=", campaignId)
      .where("status", "=", "pending")     // only move forward, never back
      .execute();
  }

  return { inserted, errors: errorCount };
}

// ── Export starter ─────────────────────────────────────────────

export function startMailInsertWorker() {
  const worker = new Worker<MailInsertJobData>(
    "mail-campaign-insert",
    processInsertJob,
    {
      connection:  redisConnection as any,
      concurrency: 5,
    }
  );

  worker.on("completed", (job, result) => {
    console.log(
      `[mailInsert] job ${job.id} (chunk ${job.data.chunkIndex + 1}/${job.data.totalChunks}) ` +
      `done — inserted: ${result.inserted}, errors: ${result.errors}`
    );
  });

  worker.on("failed", async (job, err) => {
    console.error(`[mailInsert] job ${job?.id} FAILED:`, err.message);
    if (job?.data?.campaignId) {
      await (db as any)
        .updateTable("mail_camp_summary")
        .set({ status: "failed", updated_at: new Date() })
        .where("campaign_id", "=", job.data.campaignId)
        .execute()
        .catch(() => {});
    }
  });

  console.log("[mailInsert] worker started — concurrency: 5");
  return worker;
}
