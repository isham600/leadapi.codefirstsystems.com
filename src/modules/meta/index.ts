import { FastifyInstance } from "fastify";
import metaRoutes from "./routes/meta.routes.js";

export default async function metaModule(app: FastifyInstance) {
  await app.register(metaRoutes);
}

