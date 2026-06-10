import { startMetaSyncWorker } from "./workers/meta-sync.worker.js";

console.log("[meta-sync-worker] starting...");

const worker = startMetaSyncWorker();

async function shutdown(signal: string) {
  console.log(`[meta-sync-worker] ${signal} — closing`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
