import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { z } from "zod";

async function resolveAccountUsername(req: FastifyRequest): Promise<string | null> {
  const username = req.user?.username;
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

// Email template schema for validation
const emailTemplateSchema = z.object({
  name: z.string().min(3).max(50),
  subject: z.string().min(1).max(100),
  content: z.string().min(1).max(2000),
  category: z.enum(["transactional", "promotional"]).optional().default("transactional"),
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
      if ((key === 'created_at' || key === 'updated_at') && value) {
        normalized[key] = new Date(value as any).toISOString();
      } else {
        normalized[key] = normalizeBigInt(value);
      }
    }
    return normalized;
  }
  return obj;
};

export const createEmailTemplate = async (req: FastifyRequest, reply: FastifyReply) => {
  const parsed = emailTemplateSchema.safeParse(req.body);
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

    const { name, subject, content, category } = parsed.data;

    const inserted = await (db as any)
      .insertInto("mail_templates")
      .values({
        username,
        name,
        subject,
        content,
        category,
        status: 1, // active by default for email templates
        created_at: new Date(),
        updated_at: new Date(),
      })
      .executeTakeFirst();

    // Get the created template with proper date formatting
    const createdTemplate = await (db as any)
      .selectFrom("mail_templates")
      .select([
        "id",
        "username", 
        "name",
        "subject",
        "content",
        "category",
        "status",
        "created_at",
        "updated_at"
      ])
      .where("username", "=", username)
      .where("name", "=", name)
      .executeTakeFirst();

    const processedTemplate = createdTemplate ? {
      ...createdTemplate,
      id: createdTemplate.id.toString(),
      created_at: createdTemplate.created_at ? new Date(createdTemplate.created_at).toISOString() : null,
      updated_at: createdTemplate.updated_at ? new Date(createdTemplate.updated_at).toISOString() : null
    } : null;

    return reply.status(201).send({
      status: 1,
      message: "Email template created successfully",
      data: processedTemplate,
    });
  } catch (err) {
    req.log.error({ err }, "❌ Create Email Template Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to create email template" 
    });
  }
};

export const getEmailTemplates = async (req: FastifyRequest, reply: FastifyReply) => {
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
      .selectFrom("mail_templates")
      .select([
        "id",
        "username", 
        "name",
        "subject",
        "content",
        "category",
        "status",
        "created_at",
        "updated_at"
      ])
      .where("username", "=", username);

    // Add search filter
    if (search) {
      dbQuery = dbQuery.where((eb: any) =>
        eb.or([
          eb("name", "like", `%${search}%`),
          eb("subject", "like", `%${search}%`),
          eb("content", "like", `%${search}%`)
        ])
      );
    }

    // Add status filter
    if (status && status !== 'all') {
      let statusCode: number;
      switch (status.toLowerCase()) {
        case 'pending': statusCode = 0; break;
        case 'active': statusCode = 1; break;
        case 'rejected': statusCode = 2; break;
        default: statusCode = 1;
      }
      dbQuery = dbQuery.where("status", "=", statusCode);
    }

    // Add category filter
    if (category && category !== 'all') {
      dbQuery = dbQuery.where("category", "=", category);
    }

    // Add pagination
    const offset = (page - 1) * limit;
    dbQuery = dbQuery
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset);

    const templates = await dbQuery.execute();

    // Process templates to ensure proper date formatting
    const processedTemplates = templates.map((template: any) => ({
      ...template,
      id: template.id.toString(), // Convert BigInt to string
      created_at: template.created_at ? new Date(template.created_at).toISOString() : null,
      updated_at: template.updated_at ? new Date(template.updated_at).toISOString() : null
    }));

    // Get total count for pagination
    let countQuery = (db as any)
      .selectFrom("mail_templates")
      .select((eb: any) => eb.fn.count("id").as("count"))
      .where("username", "=", username);

    // Apply same filters to count query
    if (search) {
      countQuery = countQuery.where((eb: any) =>
        eb.or([
          eb("name", "like", `%${search}%`),
          eb("subject", "like", `%${search}%`),
          eb("content", "like", `%${search}%`)
        ])
      );
    }

    if (status && status !== 'all') {
      let statusCode: number;
      switch (status.toLowerCase()) {
        case 'pending': statusCode = 0; break;
        case 'active': statusCode = 1; break;
        case 'rejected': statusCode = 2; break;
        default: statusCode = 1;
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
      message: "Email templates fetched successfully",
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
    req.log.error({ err }, "❌ Get Email Templates Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to fetch email templates" 
    });
  }
};

export const getEmailTemplate = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };

    const template = await (db as any)
      .selectFrom("mail_templates")
      .select([
        "id",
        "username", 
        "name",
        "subject",
        "content",
        "category",
        "status",
        "created_at",
        "updated_at"
      ])
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (!template) {
      return reply.status(404).send({
        status: 0,
        message: "Email template not found",
      });
    }

    // Process template to ensure proper formatting
    const processedTemplate = {
      ...template,
      id: template.id.toString(),
      created_at: template.created_at ? new Date(template.created_at).toISOString() : null,
      updated_at: template.updated_at ? new Date(template.updated_at).toISOString() : null
    };

    return reply.send({
      status: 1,
      message: "Email template fetched successfully",
      data: processedTemplate,
    });
  } catch (err) {
    req.log.error({ err }, "❌ Get Email Template Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to fetch email template" 
    });
  }
};

export const updateEmailTemplate = async (req: FastifyRequest, reply: FastifyReply) => {
  const parsed = emailTemplateSchema.partial().safeParse(req.body);
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
    const updateData = { ...parsed.data, updated_at: new Date() };

    const updated = await (db as any)
      .updateTable("mail_templates")
      .set(updateData)
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (updated.numUpdatedRows === 0) {
      return reply.status(404).send({
        status: 0,
        message: "Email template not found",
      });
    }

    // Get the updated template with proper date formatting
    const updatedTemplate = await (db as any)
      .selectFrom("mail_templates")
      .select([
        "id",
        "username", 
        "name",
        "subject",
        "content",
        "category",
        "status",
        "created_at",
        "updated_at"
      ])
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    const processedTemplate = updatedTemplate ? {
      ...updatedTemplate,
      id: updatedTemplate.id.toString(),
      created_at: updatedTemplate.created_at ? new Date(updatedTemplate.created_at).toISOString() : null,
      updated_at: updatedTemplate.updated_at ? new Date(updatedTemplate.updated_at).toISOString() : null
    } : null;

    return reply.send({
      status: 1,
      message: "Email template updated successfully",
      data: processedTemplate,
    });
  } catch (err) {
    req.log.error({ err }, "❌ Update Email Template Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to update email template" 
    });
  }
};

export const deleteEmailTemplate = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };

    const deleted = await (db as any)
      .deleteFrom("mail_templates")
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (deleted.numDeletedRows === 0) {
      return reply.status(404).send({
        status: 0,
        message: "Email template not found",
      });
    }

    return reply.send({
      status: 1,
      message: "Email template deleted successfully",
    });
  } catch (err) {
    req.log.error({ err }, "❌ Delete Email Template Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to delete email template" 
    });
  }
};