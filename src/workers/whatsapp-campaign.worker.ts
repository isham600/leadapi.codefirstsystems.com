import { Worker, Job } from "bullmq";
import { sql } from "kysely";
import { db } from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";

// ── Job data shape (one chunk of rows per job) ────────────────
export interface CampaignRow {
  receiver:  string;
  media1:    string | null;
  media2:    string | null;
  media3:    string | null;
  media4:    string | null;
  media5:    string | null;
  media6:    string | null;
  media7:    string | null;
  media8:    string | null;
  media9:    string | null;
  media10:   string | null;
  media11:   string | null;
  media12:   string | null;  // dynamic url 1
  media13:   string | null;  // dynamic url 2
}

export interface CampaignJobData {
  requestId:     string;
  username:      string;
  campaignName:  string;
  templateId:    string;
  scheduleDate:  string;
  scheduleTime:  string | null;
  chunkIndex:    number;
  totalChunks:   number;
  rows:          CampaignRow[];
}

// ── Worker processor ──────────────────────────────────────────

async function processJob(job: Job<CampaignJobData>): Promise<{ inserted: number; errors: number }> {
  const {
    requestId, username, campaignName, templateId,
    scheduleDate, scheduleTime, rows, chunkIndex, totalChunks,
  } = job.data;

  const now        = new Date();
  let   inserted   = 0;
  let   errorCount = 0;
  const errorMsgs: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      await (db as any)
        .insertInto("whatsapp_camp_details")
        .values({
          request_id:    requestId,
          username,
          name:          campaignName,
          template_id:   templateId,
          receiver:      row.receiver,
          media1:        row.media1  ?? null,
          media2:        row.media2  ?? null,
          media3:        row.media3  ?? null,
          media4:        row.media4  ?? null,
          media5:        row.media5  ?? null,
          media6:        row.media6  ?? null,
          media7:        row.media7  ?? null,
          media8:        row.media8  ?? null,
          media9:        row.media9  ?? null,
          media10:       row.media10 ?? null,
          media11:       row.media11 ?? null,
          media12:       row.media12 ?? null,
          media13:       row.media13 ?? null,
          schedule_date: scheduleDate,
          schedule_time: scheduleTime ?? null,
          status:        "PP1",
          created_at:    now,
        })
        .execute();

      inserted++;
    } catch (err: any) {
      errorCount++;
      if (errorMsgs.length < 5) errorMsgs.push(`${row.receiver}: ${err.message}`);
    }

    // Report progress every 50 rows
    if ((i + 1) % 50 === 0) {
      await job.updateProgress(Math.round(((i + 1) / rows.length) * 100));
    }
  }

  // Update tracking table (atomic increment using raw SQL)
  const isLastChunk = chunkIndex === totalChunks - 1;

  await (db as any)
    .updateTable("whatsapp_insert_job")
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

// ── Export starter function ───────────────────────────────────

export function startCampaignWorker() {
  const worker = new Worker<CampaignJobData>(
    "whatsapp-campaign-insert",
    processJob,
    {
      connection: redisConnection as any,
      concurrency: 5,
    }
  );

  worker.on("completed", (job, result) => {
    console.log(
      `[campaignWorker] job ${job.id} (chunk ${job.data.chunkIndex + 1}/${job.data.totalChunks}) ` +
      `done — inserted: ${result.inserted}, errors: ${result.errors}`
    );
  });

  worker.on("failed", async (job, err) => {
    console.error(`[campaignWorker] job ${job?.id} FAILED:`, err.message);
    if (job?.data?.requestId) {
      await (db as any)
        .updateTable("whatsapp_insert_job")
        .set({ status: "failed", error: err.message, updated_at: new Date() })
        .where("request_id", "=", job.data.requestId)
        .execute()
        .catch(() => {});
    }
  });

  console.log("[campaignWorker] started — concurrency: 5");
  return worker;
}
