import { FastifyInstance } from "fastify";
import googleRoutes from "./routes/google.routes.js";

export default async function googleModule(app: FastifyInstance) {
  await app.register(googleRoutes);
}
