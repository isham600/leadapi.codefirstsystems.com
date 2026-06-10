import { startGoogleSyncWorker } from "./workers/google-sync.worker.js";

console.log("[google-sync-worker] starting...");

const worker = startGoogleSyncWorker();

async function shutdown(signal: string) {
  console.log(`[google-sync-worker] ${signal} — closing`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
