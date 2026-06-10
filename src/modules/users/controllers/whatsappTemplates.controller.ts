import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

export type TemplateQuery = {
  // Filters
  status?: string;          // APPROVED | PENDING | REJECTED | PAUSED | DISABLED
  category?: string;        // UTILITY | MARKETING | AUTHENTICATION
  template_type?: string;   // STANDARD | FLOW | AUTH | CAROUSEL
  search?: string;          // name search (partial match)
  waba_id?: string;         // filter by specific WABA

  // Pagination
  page?: string;
  limit?: string;
};

export const getWhatsappTemplates = async (
  req: FastifyRequest<{ Querystring: TemplateQuery }>,
  reply: FastifyReply
) => {
  const username = req.user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  // ── Agent hierarchy ───────────────────────────────────────
  const userType = (req as any).user?.user_type as number | undefined;
  let accountUsername = username;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    accountUsername = parentRow?.parent_username ?? username;
  }

  const {
    status,
    category,
    template_type,
    search,
    waba_id,
    page = "1",
    limit = "20",
  } = req.query;

  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset   = (pageNum - 1) * limitNum;

  // ── Build base query ──────────────────────────────────────
  let query = (db as any)
    .selectFrom("whatsapp_templates")
    .where("username", "=", accountUsername);

  let countQuery = (db as any)
    .selectFrom("whatsapp_templates")
    .where("username", "=", accountUsername);

  if (status)        { query = query.where("status", "=", status);                countQuery = countQuery.where("status", "=", status); }
  if (category)      { query = query.where("category", "=", category);            countQuery = countQuery.where("category", "=", category); }
  if (template_type) { query = query.where("template_type", "=", template_type);  countQuery = countQuery.where("template_type", "=", template_type); }
  if (waba_id)       { query = query.where("waba_id", "=", BigInt(waba_id));       countQuery = countQuery.where("waba_id", "=", BigInt(waba_id)); }
  if (search)        { query = query.where("name", "like", `%${search}%`);         countQuery = countQuery.where("name", "like", `%${search}%`); }

  // ── Fetch data + total count in parallel ──────────────────
  const [templates, [{ total }], overview] = await Promise.all([
    query
      .select([
        "id",
        "waba_id",
        "meta_template_id",
        "name",
        "language",
        "category",
        "status",
        "template_type",
        "header_type",
        "header_text",
        "body_message",
        "footer_text",
        "button_type",
        "button_count",
        "total_variable_count",
        "synced_at",
        "updated_at",
      ])
      .orderBy("id", "desc")
      .limit(limitNum)
      .offset(offset)
      .execute(),

    countQuery
      .select((eb: any) => eb.fn.countAll().as("total"))
      .execute(),

    // Overview — SUM(CASE WHEN ...) for MariaDB/MySQL compatibility
    (db as any)
      .selectFrom("whatsapp_templates")
      .select([
        (eb: any) => eb.fn.countAll().as("total"),
        (eb: any) => eb.fn.sum(eb.case().when("status", "=", "APPROVED").then(1).else(0).end()).as("approved"),
        (eb: any) => eb.fn.sum(eb.case().when("status", "=", "PENDING").then(1).else(0).end()).as("pending"),
        (eb: any) => eb.fn.sum(eb.case().when("status", "=", "REJECTED").then(1).else(0).end()).as("rejected"),
        (eb: any) => eb.fn.sum(eb.case().when("category", "=", "MARKETING").then(1).else(0).end()).as("marketing"),
        (eb: any) => eb.fn.sum(eb.case().when("category", "=", "UTILITY").then(1).else(0).end()).as("utility"),
        (eb: any) => eb.fn.sum(eb.case().when("category", "=", "AUTHENTICATION").then(1).else(0).end()).as("authentication"),
      ])
      .where("username", "=", accountUsername)
      .executeTakeFirst(),
  ]);

  const totalCount = parseInt(String(total), 10);
  const totalPages = Math.ceil(totalCount / limitNum);

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Templates fetched",
    overview: {
      total:          parseInt(String(overview?.total ?? 0), 10),
      approved:       parseInt(String(overview?.approved ?? 0), 10),
      pending:        parseInt(String(overview?.pending ?? 0), 10),
      rejected:       parseInt(String(overview?.rejected ?? 0), 10),
      marketing:      parseInt(String(overview?.marketing ?? 0), 10),
      utility:        parseInt(String(overview?.utility ?? 0), 10),
      authentication: parseInt(String(overview?.authentication ?? 0), 10),
    },
    pagination: {
      page:        pageNum,
      limit:       limitNum,
      total:       totalCount,
      total_pages: totalPages,
      has_next:    pageNum < totalPages,
      has_prev:    pageNum > 1,
    },
    data: templates,
  });
};
