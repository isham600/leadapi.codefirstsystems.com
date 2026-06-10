import { Queue } from "bullmq";
import IORedis from "ioredis";

// Shared Redis connection (maxRetriesPerRequest: null is required by BullMQ)
export const redisConnection = new IORedis({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? undefined,
  maxRetriesPerRequest: null,
});

// Queue: each job = one chunk of campaign rows to insert into whatsapp_camp_details
export const campaignInsertQueue = new Queue("whatsapp-campaign-insert", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail:    { count: 1000 },
  },
});
