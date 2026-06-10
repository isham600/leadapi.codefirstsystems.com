/**
 * Standalone BullMQ worker process.
 * Started separately by PM2 — runs independently from the API server.
 * Jobs are stored in Redis so this worker can restart without losing work.
 */
import { startCampaignWorker }           from "./workers/whatsapp-campaign.worker.js";
import { startMetaSyncWorker }            from "./workers/meta-sync.worker.js";
import { startTemplateSubmitWorker }      from "./workers/whatsapp-template-submit.worker.js";
import { startBillingDeductionWorker }    from "./workers/billing-deduction.worker.js";
console.log("[worker] starting...");

const workers = [
  startCampaignWorker(),
  startMetaSyncWorker(),
  startTemplateSubmitWorker(),
  startBillingDeductionWorker(),
];

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received — closing gracefully`);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
