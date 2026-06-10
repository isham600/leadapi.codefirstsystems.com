import { Queue } from "bullmq";
import { redisConnection } from "./campaign.queue.js";

// ── Insert job: carries a chunk of recipients to write to DB ──
export interface MailRecipientRow {
  email:         string;
  recipientName: string | null;
  customVars:    Record<string, string>;   // {"name":"John","company":"ACME"}
}

export interface MailInsertJobData {
  campaignId:  string;
  username:    string;
  chunkIndex:  number;
  totalChunks: number;
  rows:        MailRecipientRow[];
}

// ── Send job: one per campaign, triggers actual email sending ──
export interface MailSendJobData {
  campaignId: string;
  username:   string;
}

export const mailInsertQueue = new Queue<MailInsertJobData>("mail-campaign-insert", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts:  3,
    backoff:   { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 50  },
  },
});

export const mailSendQueue = new Queue<MailSendJobData>("mail-campaign-send", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts:  2,
    backoff:   { type: "exponential", delay: 15000 },
    removeOnComplete: { count: 50 },
    removeOnFail:     { count: 50 },
  },
});
