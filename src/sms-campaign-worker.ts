/**
 * Standalone BullMQ worker process for SMS campaign inserts.
 * Started separately by PM2 — isolated from the WhatsApp worker process.
 */
import { startSmsCampaignWorker } from "./workers/sms-campaign.worker.js";

console.log("[sms-campaign-worker] starting...");

const worker = startSmsCampaignWorker();

async function shutdown(signal: string) {
  console.log(`[sms-campaign-worker] ${signal} received — closing gracefully`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
