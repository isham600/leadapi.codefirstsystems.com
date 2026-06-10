// PM2 entry point — Phone AI Campaign Worker
// pm2 start ecosystem.config.cjs --only apilead-worker-phone-ai-campaign
import { startPhoneAiCampaignWorker } from "./workers/phone-ai-campaign.worker.js";

const worker = startPhoneAiCampaignWorker();

async function shutdown(signal: string) {
  console.log(`[phone-ai-campaign] received ${signal} — draining worker...`);
  await worker.close();
  console.log("[phone-ai-campaign] worker closed gracefully");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
