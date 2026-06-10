import { Queue } from "bullmq";
import { redisConnection } from "./campaign.queue.js";

export interface MetaSyncJobData {
  username:     string;
  accountId:    number;
  pageId:       string;
  adAccountId:  string | null;
  accessToken:  string;
  /**
   * "cache" = lead forms + campaigns cache only | "leads" = leads → lead manager only
   * "all" = both | "auto" = scheduled tick: fan out a cache sync per active account
   */
  syncType:     "cache" | "leads" | "all" | "auto";
  /** Meta insights date_preset for campaign stats (default last_30d) */
  datePreset?:  string;
}

export const metaSyncQueue = new Queue<MetaSyncJobData>("meta-sync", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 200 },
    removeOnFail:    { count: 200 },
  },
});
