// PM2 entry point — Mail Campaign Send Worker
// pm2 start ecosystem.config.cjs --only apilead-worker-mail-send
import { startMailSendWorker } from "./workers/mail-campaign-send.worker.js";

const worker = startMailSendWorker();

async function shutdown(signal: string) {
  console.log(`[mailSend] received ${signal} — draining worker...`);
  await worker.close();
  console.log("[mailSend] worker closed gracefully");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
