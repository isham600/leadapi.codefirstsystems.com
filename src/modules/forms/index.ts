import { FastifyInstance } from "fastify";
import webFormsRoutes from "./routes/web-forms.routes.js";

export async function registerFormsModule(fastify: FastifyInstance) {
  await fastify.register(webFormsRoutes);
}

export default registerFormsModule;
