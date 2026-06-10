import { startWhatsappTemplateSyncWorker } from "./workers/whatsapp-template-sync.worker.js";

console.log("[whatsapp-template-sync-worker] starting...");

const worker = startWhatsappTemplateSyncWorker();

async function shutdown(signal: string) {
  console.log(`[whatsapp-template-sync-worker] ${signal} — closing`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
