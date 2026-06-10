import { FastifyInstance } from "fastify";
import { verifyJwt } from "../../Middleware/auth.Middleware.js";
import {
  createWebForm,
  getWebForm,
  updateWebForm,
  deleteWebForm,
  submitWebFormLead,
  getFormSubmissions,
} from "../controllers/web-forms.controller.js";

export default async function webFormsRoutes(fastify: FastifyInstance) {
  // ── Web Form Management (Authenticated) ──────────────────
  fastify.post("/", { preHandler: verifyJwt }, createWebForm);
  fastify.get("/", { preHandler: verifyJwt }, getWebForm);
  fastify.put("/", { preHandler: verifyJwt }, updateWebForm);
  fastify.delete("/", { preHandler: verifyJwt }, deleteWebForm);

  // ── Form Submissions (Public - no auth required) ────────
  fastify.post<{ Querystring: { key?: string } }>(
    "/submit",
    submitWebFormLead
  );

  // ── Submissions List (Authenticated) ────────────────────
  fastify.get<{ Querystring: { page?: string; limit?: string; status?: string } }>(
    "/submissions",
    { preHandler: verifyJwt },
    getFormSubmissions
  );
}
