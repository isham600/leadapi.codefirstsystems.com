import { Worker, Job } from "bullmq";
import { sql }         from "kysely";
import { db }          from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";

// ── Job data shapes ───────────────────────────────────────────────

export interface SmsCampaignRow {
  receiver: string;
}

export interface SmsCampaignJobData {
  requestId:     string;
  username:      string;
  broadcastName: string;
  senderId:      string;
  msg:           string;
  msgMode:       string;
  msgRoutes:     string;
  templateId:    string | null;
  peid:          string | null;
  unicode:       number;
  flash:         number;
  scheduleDate:  string;
  scheduleTime:  string | null;
  chunkIndex:    number;
  totalChunks:   number;
  rows:          SmsCampaignRow[];
}

// ── Worker processor ──────────────────────────────────────────────

async function processJob(job: Job<SmsCampaignJobData>): Promise<{ inserted: number; errors: number }> {
  const {
    requestId, username, broadcastName, senderId, msg, msgMode,
    msgRoutes, templateId, peid, unicode, flash,
    scheduleDate, scheduleTime,
    rows, chunkIndex, totalChunks,
  } = job.data;

  const now        = new Date();
  let   inserted   = 0;
  let   errorCount = 0;
  const errorMsgs: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      await (db as any)
        .insertInto("smpp_campaign_details")
        .values({
          username,
          request_id:     requestId,
          broadcast_name: broadcastName,
          sender_id:      senderId,
          msg,
          msg_mode:       msgMode,
          msg_routes:     msgRoutes,
          template_id:    templateId ?? null,
          peid:           peid ?? null,
          receiver:       row.receiver,
          status:         "PP1",
          unicode,
          flash,
          rid:            null,
          schedule_date:  scheduleDate,
          schedule_time:  scheduleTime ?? null,
          created_at:     now,
          updated_at:     now,
        })
        .execute();

      inserted++;
    } catch (err: any) {
      errorCount++;
      if (errorMsgs.length < 5) errorMsgs.push(`${row.receiver}: ${err.message}`);
    }

    if ((i + 1) % 50 === 0) {
      await job.updateProgress(Math.round(((i + 1) / rows.length) * 100));
    }
  }

  const isLastChunk = chunkIndex === totalChunks - 1;

  await (db as any)
    .updateTable("smpp_insert_job")
    .set(isLastChunk
      ? {
          status:       errorMsgs.length > 0 ? "completed_with_errors" : "completed",
          processed:    sql`processed + ${inserted}`,
          failed_count: sql`failed_count + ${errorCount}`,
          error:        errorMsgs.length > 0 ? errorMsgs.join(" | ") : null,
          updated_at:   now,
        }
      : {
          status:       "processing",
          processed:    sql`processed + ${inserted}`,
          failed_count: sql`failed_count + ${errorCount}`,
          updated_at:   now,
        }
    )
    .where("request_id", "=", requestId)
    .execute();

  return { inserted, errors: errorCount };
}

// ── Export starter ────────────────────────────────────────────────

export function startSmsCampaignWorker() {
  const worker = new Worker<SmsCampaignJobData>(
    "sms-campaign-insert",
    processJob,
    {
      connection:  redisConnection as any,
      concurrency: 5,
    },
  );

  worker.on("completed", (job, result) => {
    console.log(
      `[smsCampaignWorker] job ${job.id} (chunk ${job.data.chunkIndex + 1}/${job.data.totalChunks}) ` +
      `done — inserted: ${result.inserted}, errors: ${result.errors}`,
    );
  });

  worker.on("failed", async (job, err) => {
    console.error(`[smsCampaignWorker] job ${job?.id} FAILED:`, err.message);
    if (job?.data?.requestId) {
      await (db as any)
        .updateTable("smpp_insert_job")
        .set({ status: "failed", error: err.message, updated_at: new Date() })
        .where("request_id", "=", job.data.requestId)
        .execute()
        .catch(() => {});
    }
  });

  console.log("[smsCampaignWorker] started — concurrency: 5");
  return worker;
}
