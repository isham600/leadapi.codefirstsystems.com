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

// GET /rcs/campaigns
export const getRcsCampaigns = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const q   = req.query as { page?: string; limit?: string; status?: string };
  const page  = Math.max(1, Number(q.page  ?? 1));
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
  const offset = (page - 1) * limit;

  let query = (db as any)
    .selectFrom("rcs_camp_summary")
    .selectAll()
    .where("username", "=", username);

  if (q.status) query = query.where("status", "=", q.status);

  const [rows, countRow] = await Promise.all([
    query.orderBy("created_at", "desc").limit(limit).offset(offset).execute(),
    (db as any)
      .selectFrom("rcs_camp_summary")
      .select((eb: any) => eb.fn.count("id").as("total"))
      .where("username", "=", username)
      .$if(!!q.status, (qb: any) => qb.where("status", "=", q.status))
      .executeTakeFirst(),
  ]);

  return reply.send({
    status: 1,
    data: rows,
    total: Number(countRow?.total ?? 0),
    page,
    limit,
  });
};

// POST /rcs/campaign/submit
export const submitRcsCampaign = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const body = req.body as any;
  const { name, template_id, phone_numbers, scheduled_date, scheduled_time, sms_fallback } = body;

  if (!name?.trim()) return reply.code(400).send({ status: 0, message: "Campaign name is required." });
  if (!template_id)  return reply.code(400).send({ status: 0, message: "template_id is required." });
  if (!Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return reply.code(400).send({ status: 0, message: "At least one phone number is required." });
  }

  // Get template name for display
  let template_name = "";
  try {
    const tpl = await (db as any)
      .selectFrom("rcs_templates")
      .select(["name", "message_type"])
      .where("id", "=", Number(template_id))
      .where("username", "=", username)
      .executeTakeFirst();
    if (!tpl) return reply.code(404).send({ status: 0, message: "Template not found." });
    template_name = tpl.name;
  } catch {
    return reply.code(500).send({ status: 0, message: "Failed to load template." });
  }

  const now = new Date();

  // Insert campaign summary row and get the new ID
  const result = await (db as any)
    .insertInto("rcs_camp_summary")
    .values({
      username,
      name:           name.trim(),
      template_id:    Number(template_id),
      template_name,
      audience:       phone_numbers.length,
      sent:           0,
      delivered:      0,
      read_count:     0,
      status:         scheduled_date ? "scheduled" : "pending",
      sms_fallback:   sms_fallback ? 1 : 0,
      scheduled_date: scheduled_date ?? null,
      scheduled_time: scheduled_time ?? null,
      created_at:     now,
      updated_at:     now,
    })
    .executeTakeFirst();

  const campId = Number(result?.insertId ?? 0);

  // Insert one detail row per recipient (batch insert)
  if (campId > 0 && phone_numbers.length > 0) {
    const detailRows = phone_numbers.map((phone: string) => ({
      camp_id:      campId,
      username,
      phone_number: phone.trim(),
      status:       "pending",
      created_at:   now,
      updated_at:   now,
    }));
    // Insert in chunks of 500 to avoid query size limits
    const CHUNK = 500;
    for (let i = 0; i < detailRows.length; i += CHUNK) {
      await (db as any)
        .insertInto("rcs_camp_details")
        .values(detailRows.slice(i, i + CHUNK))
        .execute();
    }
  }

  return reply.code(201).send({ status: 1, message: "Campaign submitted successfully.", data: { camp_id: campId } });
};
