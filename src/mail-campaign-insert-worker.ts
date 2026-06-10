// PM2 entry point — Mail Campaign Insert Worker
// pm2 start ecosystem.config.cjs --only apilead-worker-mail-insert
import { startMailInsertWorker } from "./workers/mail-campaign-insert.worker.js";

const worker = startMailInsertWorker();

async function shutdown(signal: string) {
  console.log(`[mailInsert] received ${signal} — draining worker...`);
  await worker.close();
  console.log("[mailInsert] worker closed gracefully");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
