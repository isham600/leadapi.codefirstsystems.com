import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { z } from "zod";

// Template schema for validation
const templateSchema = z.object({
  template_name: z.string().min(3).max(50),
  message: z.string().min(1).max(1600),
  teid: z.string().regex(/^\d{10,30}$/, "TEID must be 10-30 digits").or(z.literal("")).optional(), // Optional TEID, can be empty string or valid digits
  language: z.enum(["English", "Unicode"]).optional(),
});

// Normalize BigInt values and Dates for JSON serialization
const normalizeBigInt = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(normalizeBigInt);
  if (typeof obj === 'object') {
    const normalized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Handle date fields specifically
      if ((key === 'create_at' || key === 'update_at') && value) {
        normalized[key] = new Date(value as any).toISOString();
      } else {
        normalized[key] = normalizeBigInt(value);
      }
    }
    return normalized;
  }
  return obj;
};

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

export const createTemplate = async (req: FastifyRequest, reply: FastifyReply) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ 
      status: 0, 
      message: "Validation failed",
      errors: parsed.error.flatten() 
    });
  }

  try {
    // Get username from JWT
    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { template_name, message, teid } = parsed.data;

    const inserted = await (db as any)
      .insertInto("smpp_templates")
      .values({
        username,
        template_name,
        message,
        teid, // safe as string
        status: 0, // always pending
        create_at: new Date(),
        update_at: new Date(),
      })
      .executeTakeFirst();

    // Get the created template with proper date formatting
    const createdTemplate = await (db as any)
      .selectFrom("smpp_templates")
      .select([
        "id",
        "username", 
        "template_name",
        "message",
        "teid",
        "peid",
        "status",
        "create_at",
        "update_at"
      ])
      .where("username", "=", username)
      .where("template_name", "=", template_name)
      .executeTakeFirst();

    const processedTemplate = createdTemplate ? {
      ...createdTemplate,
      id: createdTemplate.id.toString(),
      create_at: createdTemplate.create_at ? new Date(createdTemplate.create_at).toISOString().slice(0, 19).replace('T', ' ') : null,
      update_at: createdTemplate.update_at ? new Date(createdTemplate.update_at).toISOString().slice(0, 19).replace('T', ' ') : null
    } : null;

    return reply.status(201).send({
      status: 1,
      message: "Template created successfully (Pending Approval)",
      data: processedTemplate,
    });
  } catch (err) {
    req.log.error({ err }, "❌ Create Template Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to create template" 
    });
  }
};

export const getTemplates = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    // Extract query parameters
    const query = req.query as any;
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 20;
    const search = query.search || '';
    const status = query.status || '';
    const category = query.category || '';

    // Build the query
    let dbQuery = (db as any)
      .selectFrom("smpp_templates")
      .select([
        "id",
        "username", 
        "template_name",
        "message",
        "teid",
        "peid",
        "status",
        "create_at",
        "update_at"
      ])
      .where("username", "=", username);

    // Add search filter
    if (search) {
      dbQuery = dbQuery.where((eb: any) =>
        eb.or([
          eb("template_name", "like", `%${search}%`),
          eb("message", "like", `%${search}%`)
        ])
      );
    }

    // Add status filter
    if (status && status !== 'all') {
      let statusCode: number;
      switch (status.toLowerCase()) {
        case 'pending': statusCode = 0; break;
        case 'active': statusCode = 1; break;
        case 'rejected': statusCode = 3; break;
        default: statusCode = 0;
      }
      dbQuery = dbQuery.where("status", "=", statusCode);
    }

    // Add category filter (if you add category column to the table)
    if (category && category !== 'all') {
      dbQuery = dbQuery.where("category", "=", category);
    }

    // Add pagination
    const offset = (page - 1) * limit;
    dbQuery = dbQuery
      .orderBy("create_at", "desc")
      .limit(limit)
      .offset(offset);

    const templates = await dbQuery.execute();

    // Process templates to ensure proper date formatting
    const processedTemplates = templates.map((template: any) => ({
      ...template,
      id: template.id.toString(), // Convert BigInt to string
      create_at: template.create_at ? new Date(template.create_at).toISOString().slice(0, 19).replace('T', ' ') : null,
      update_at: template.update_at ? new Date(template.update_at).toISOString().slice(0, 19).replace('T', ' ') : null
    }));

    // Get total count for pagination
    let countQuery = (db as any)
      .selectFrom("smpp_templates")
      .select((eb: any) => eb.fn.count("id").as("count"))
      .where("username", "=", username);

    // Apply same filters to count query
    if (search) {
      countQuery = countQuery.where((eb: any) =>
        eb.or([
          eb("template_name", "like", `%${search}%`),
          eb("message", "like", `%${search}%`)
        ])
      );
    }

    if (status && status !== 'all') {
      let statusCode: number;
      switch (status.toLowerCase()) {
        case 'pending': statusCode = 0; break;
        case 'active': statusCode = 1; break;
        case 'rejected': statusCode = 3; break;
        default: statusCode = 0;
      }
      countQuery = countQuery.where("status", "=", statusCode);
    }

    if (category && category !== 'all') {
      countQuery = countQuery.where("category", "=", category);
    }

    const countResult = await countQuery.executeTakeFirst();
    const total = parseInt(countResult?.count || '0');
    const totalPages = Math.ceil(total / limit);

    return reply.send({
      status: 1,
      message: "Templates fetched successfully",
      data: processedTemplates,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    });
  } catch (err) {
    req.log.error({ err }, "❌ Get Templates Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to fetch templates" 
    });
  }
};

export const getTemplate = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };

    const template = await (db as any)
      .selectFrom("smpp_templates")
      .select([
        "id",
        "username", 
        "template_name",
        "message",
        "teid",
        "peid",
        "status",
        "create_at",
        "update_at"
      ])
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (!template) {
      return reply.status(404).send({
        status: 0,
        message: "Template not found",
      });
    }

    // Process template to ensure proper formatting
    const processedTemplate = {
      ...template,
      id: template.id.toString(),
      create_at: template.create_at ? new Date(template.create_at).toISOString().slice(0, 19).replace('T', ' ') : null,
      update_at: template.update_at ? new Date(template.update_at).toISOString().slice(0, 19).replace('T', ' ') : null
    };

    return reply.send({
      status: 1,
      message: "Template fetched successfully",
      data: processedTemplate,
    });
  } catch (err) {
    req.log.error({ err }, "❌ Get Template Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to fetch template" 
    });
  }
};

export const updateTemplate = async (req: FastifyRequest, reply: FastifyReply) => {
  const parsed = templateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ 
      status: 0, 
      message: "Validation failed",
      errors: parsed.error.flatten() 
    });
  }

  try {
    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };
    const updateData = { ...parsed.data, update_at: new Date() };

    const updated = await (db as any)
      .updateTable("smpp_templates")
      .set(updateData)
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (updated.numUpdatedRows === 0) {
      return reply.status(404).send({
        status: 0,
        message: "Template not found",
      });
    }

    // Get the updated template with proper date formatting
    const updatedTemplate = await (db as any)
      .selectFrom("smpp_templates")
      .select([
        "id",
        "username", 
        "template_name",
        "message",
        "teid",
        "peid",
        "status",
        "create_at",
        "update_at"
      ])
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    const processedTemplate = updatedTemplate ? {
      ...updatedTemplate,
      id: updatedTemplate.id.toString(),
      create_at: updatedTemplate.create_at ? new Date(updatedTemplate.create_at).toISOString().slice(0, 19).replace('T', ' ') : null,
      update_at: updatedTemplate.update_at ? new Date(updatedTemplate.update_at).toISOString().slice(0, 19).replace('T', ' ') : null
    } : null;

    return reply.send({
      status: 1,
      message: "Template updated successfully",
      data: processedTemplate,
    });
  } catch (err) {
    req.log.error({ err }, "❌ Update Template Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to update template" 
    });
  }
};

export const deleteTemplate = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };

    const deleted = await (db as any)
      .deleteFrom("smpp_templates")
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (deleted.numDeletedRows === 0) {
      return reply.status(404).send({
        status: 0,
        message: "Template not found",
      });
    }

    return reply.send({
      status: 1,
      message: "Template deleted successfully",
    });
  } catch (err) {
    req.log.error({ err }, "❌ Delete Template Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to delete template" 
    });
  }
};