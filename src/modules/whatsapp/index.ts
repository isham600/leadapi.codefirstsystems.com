import { FastifyInstance } from "fastify";
import whatsappRoutes from "./routes/whatsapp.routes.js";

export async function registerWhatsappModule(fastify: FastifyInstance) {
  await fastify.register(whatsappRoutes);
}

export default registerWhatsappModule;
