import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

async function resolveAccountUsername(req: FastifyRequest): Promise<string | null> {
  const username = (req as any).user?.username ?? null;
  if (!username) return null;
  const userType = (req as any).user?.user_type as number | undefined;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    return parentRow?.parent_username ?? username;
  }
  return username;
}

// GET /rcsTemplates
export const getRcsTemplates = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const q = req.query as { message_type?: string; search?: string };

  let query = (db as any)
    .selectFrom("rcs_templates")
    .selectAll()
    .where("username", "=", username);

  if (q.message_type) query = query.where("message_type", "=", q.message_type);
  if (q.search?.trim()) {
    query = query.where("name", "like", `%${q.search.trim()}%`);
  }

  const templates = await query.orderBy("created_at", "desc").execute();

  // Parse JSON fields
  const parsed = templates.map((t: any) => ({
    ...t,
    rich_card:          t.rich_card_json          ? JSON.parse(t.rich_card_json)          : null,
    carousel_cards:     t.carousel_cards_json      ? JSON.parse(t.carousel_cards_json)     : [],
    suggested_replies:  t.suggested_replies_json   ? JSON.parse(t.suggested_replies_json)  : [],
  }));

  return reply.send({ status: 1, data: { templates: parsed } });
};

// POST /rcsTemplates/create
export const createRcsTemplate = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const body = req.body as any;
  const { name, message_type, body_text, rich_card, carousel_cards, suggested_replies } = body;

  if (!name?.trim() || !message_type) {
    return reply.code(400).send({ status: 0, message: "name and message_type are required." });
  }

  const now = new Date();
  await (db as any)
    .insertInto("rcs_templates")
    .values({
      username,
      name:                    name.trim(),
      message_type,
      body_text:               body_text ?? null,
      rich_card_json:          rich_card           ? JSON.stringify(rich_card)           : null,
      carousel_cards_json:     carousel_cards      ? JSON.stringify(carousel_cards)      : null,
      suggested_replies_json:  suggested_replies   ? JSON.stringify(suggested_replies)   : null,
      status:                  "pending",
      created_at:              now,
      updated_at:              now,
    })
    .execute();

  return reply.code(201).send({ status: 1, message: "Template created." });
};

// PUT /rcsTemplates/:id/status  — approve / reject a template
export const updateRcsTemplateStatus = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const body = req.body as any;
  const newStatus = String(body?.status ?? "").trim();

  if (!["pending", "active", "rejected"].includes(newStatus)) {
    return reply.code(400).send({ status: 0, message: "status must be one of: pending, active, rejected" });
  }

  const updated = await (db as any)
    .updateTable("rcs_templates")
    .set({ status: newStatus, updated_at: new Date() })
    .where("id",       "=", Number(req.params.id))
    .where("username", "=", username)
    .executeTakeFirst();

  if (Number(updated?.numUpdatedRows ?? 0) === 0) {
    return reply.code(404).send({ status: 0, message: "Template not found." });
  }

  return reply.send({ status: 1, message: `Template ${newStatus}.` });
};

// DELETE /rcsTemplates/:id
export const deleteRcsTemplate = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .deleteFrom("rcs_templates")
    .where("id", "=", Number(req.params.id))
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "Template deleted." });
};
