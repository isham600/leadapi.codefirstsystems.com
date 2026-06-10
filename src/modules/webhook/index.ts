import type { FastifyInstance } from "fastify";
import webhookRoutes from "./routes/webhook.routes.js";

export default async function webhookModule(app: FastifyInstance) {
  await app.register(webhookRoutes);
}
