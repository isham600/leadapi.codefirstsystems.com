import type { FastifyInstance } from "fastify";
import billingRoutes from "./routes/billing.routes.js";

export default async function billingModule(app: FastifyInstance) {
  await app.register(billingRoutes, { prefix: "/billing" });
}
