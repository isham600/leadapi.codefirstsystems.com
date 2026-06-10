import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import crypto from "crypto";

// ────────────────────────────────────────────────────────────
// 📋 WEB FORMS CRUD
// ────────────────────────────────────────────────────────────

export const createWebForm = async (
  req: FastifyRequest<{
    Body: {
      form_title?: string;
      form_description?: string;
      form_fields?: Array<{
        name: string;
        label: string;
        type: "text" | "email" | "phone" | "textarea" | "number";
        required: boolean;
      }>;
      allowed_origins?: string[];
    };
  }>,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) {
      return reply.status(401).send({
        status: 0,
        message: "Unauthorized",
        data: null,
      });
    }

    const {
      form_title = "My Web Form",
      form_description,
      form_fields = [
        { name: "first_name", label: "First Name", type: "text", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "phone", label: "Phone", type: "phone", required: false },
        { name: "message", label: "Message", type: "textarea", required: false },
      ],
      allowed_origins = [],
    } = req.body;

    // Generate unique embed key
    const embed_key = `wf_${crypto.randomBytes(16).toString("hex")}`;
    const webhook_url = `${process.env.BACKEND_URL || "http://127.0.0.1:3004"}/api/forms/submit?key=${embed_key}`;

    const result = await db
      .insertInto("web_forms")
      .values({
        username,
        embed_key,
        webhook_url,
        form_title,
        form_description: form_description || null,
        form_fields: JSON.stringify(form_fields),
        allowed_origins: JSON.stringify(allowed_origins),
        total_submissions: 0,
        total_leads_created: 0,
        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirst();

    reply.status(201).send({
      status: 1,
      message: "Web form created successfully",
      data: {
        id: result?.id,
        embed_key: result?.embed_key,
        webhook_url: result?.webhook_url,
        form_title: result?.form_title,
      },
    });
  } catch (error: any) {
    console.error(error);
    reply.status(500).send({
      status: 0,
      message: "Failed to create web form",
      error: error.message,
    });
  }
};

export const getWebForm = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) {
      return reply.status(401).send({
        status: 0,
        message: "Unauthorized",
        data: null,
      });
    }

    const form = await db
      .selectFrom("web_forms")
      .selectAll()
      .where("username", "=", username)
      .executeTakeFirst();

    if (!form) {
      return reply.status(200).send({
        status: 1,
        message: "No web form configured",
        data: null,
      });
    }

    // Get submission stats
    const submissions = await db
      .selectFrom("form_submissions")
      .select([
        db.fn.count("id").as("total"),
        db.fn.sum(
          db.case().when("conversion_status", "=", "converted").then(1).end()
        ).as("converted"),
      ])
      .where("form_id", "=", form.id)
      .executeTakeFirst();

    reply.status(200).send({
      status: 1,
      message: "Web form retrieved",
      data: {
        ...form,
        form_fields: form.form_fields ? JSON.parse(form.form_fields as string) : [],
        allowed_origins: form.allowed_origins ? JSON.parse(form.allowed_origins as string) : [],
        stats: {
          total_submissions: Number(submissions?.total || 0),
          converted_leads: Number(submissions?.converted || 0),
        },
      },
    });
  } catch (error: any) {
    console.error(error);
    reply.status(500).send({
      status: 0,
      message: "Failed to fetch web form",
      error: error.message,
    });
  }
};

export const updateWebForm = async (
  req: FastifyRequest<{
    Body: {
      form_title?: string;
      form_description?: string;
      form_fields?: any;
      allowed_origins?: string[];
      status?: "active" | "inactive" | "archived";
    };
  }>,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) {
      return reply.status(401).send({
        status: 0,
        message: "Unauthorized",
        data: null,
      });
    }

    const { form_title, form_description, form_fields, allowed_origins, status } = req.body;

    const form = await db
      .selectFrom("web_forms")
      .select("id")
      .where("username", "=", username)
      .executeTakeFirst();

    if (!form) {
      return reply.status(404).send({
        status: 0,
        message: "Web form not found",
        data: null,
      });
    }

    const updateData: any = { updated_at: new Date() };
    if (form_title) updateData.form_title = form_title;
    if (form_description !== undefined) updateData.form_description = form_description;
    if (form_fields) updateData.form_fields = JSON.stringify(form_fields);
    if (allowed_origins) updateData.allowed_origins = JSON.stringify(allowed_origins);
    if (status) updateData.status = status;

    await db
      .updateTable("web_forms")
      .set(updateData)
      .where("id", "=", form.id)
      .execute();

    reply.status(200).send({
      status: 1,
      message: "Web form updated",
      data: null,
    });
  } catch (error: any) {
    console.error(error);
    reply.status(500).send({
      status: 0,
      message: "Failed to update web form",
      error: error.message,
    });
  }
};

export const deleteWebForm = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) {
      return reply.status(401).send({
        status: 0,
        message: "Unauthorized",
        data: null,
      });
    }

    const form = await db
      .selectFrom("web_forms")
      .select("id")
      .where("username", "=", username)
      .executeTakeFirst();

    if (!form) {
      return reply.status(404).send({
        status: 0,
        message: "Web form not found",
        data: null,
      });
    }

    await db
      .deleteFrom("web_forms")
      .where("id", "=", form.id)
      .execute();

    reply.status(200).send({
      status: 1,
      message: "Web form deleted",
      data: null,
    });
  } catch (error: any) {
    console.error(error);
    reply.status(500).send({
      status: 0,
      message: "Failed to delete web form",
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────
// 📨 FORM SUBMISSION (PUBLIC - NO AUTH REQUIRED)
// ────────────────────────────────────────────────────────────

export const submitWebFormLead = async (
  req: FastifyRequest<{
    Querystring: { key?: string };
    Body: any;
  }>,
  reply: FastifyReply
) => {
  try {
    const { key } = req.query;

    if (!key) {
      return reply.status(400).send({
        status: 0,
        message: "Missing embed key",
        data: null,
      });
    }

    // Get form by embed key
    const form = await db
      .selectFrom("web_forms")
      .selectAll()
      .where("embed_key", "=", key)
      .where("status", "=", "active")
      .executeTakeFirst();

    if (!form) {
      return reply.status(404).send({
        status: 0,
        message: "Form not found or inactive",
        data: null,
      });
    }

    const body = req.body as any;

    // Extract standard fields
    const first_name = body.first_name || null;
    const last_name = body.last_name || null;
    const email = body.email || null;
    const phone = body.phone || null;
    const company = body.company || null;
    const message = body.message || null;

    // Extract UTM parameters
    const utm_source = body.utm_source || null;
    const utm_medium = body.utm_medium || null;
    const utm_campaign = body.utm_campaign || null;
    const utm_term = body.utm_term || null;
    const utm_content = body.utm_content || null;
    const referrer = body.referrer || null;
    const page_url = body.page_url || null;

    // Extract IP and user agent
    const ip_address = req.ip || null;
    const user_agent = req.headers["user-agent"] || null;

    // Extract custom fields (everything else)
    const custom_fields = Object.keys(body).reduce((acc: any, key: string) => {
      if (!["first_name", "last_name", "email", "phone", "company", "message", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer", "page_url"].includes(key)) {
        acc[key] = body[key];
      }
      return acc;
    }, {});

    // Save submission
    const submission = await db
      .insertInto("form_submissions")
      .values({
        form_id: form.id,
        username: form.username,
        first_name,
        last_name,
        email,
        phone,
        company,
        message,
        custom_fields: Object.keys(custom_fields).length > 0 ? JSON.stringify(custom_fields) : null,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        referrer,
        page_url,
        ip_address,
        user_agent,
        conversion_status: "pending",
        submitted_at: new Date(),
        created_at: new Date(),
      })
      .returningAll()
      .executeTakeFirst();

    // Try to create lead (best effort - don't fail if it errors)
    try {
      if (email || phone) {
        const leadData: any = {
          username: form.username,
          first_name,
          last_name,
          email,
          phone,
          source: "web_form",
          status: "NEW",
          created_by: form.username,
          created_at: new Date(),
          updated_at: new Date(),
        };

        if (message) leadData.notes = message;
        if (page_url) leadData.landing_page = page_url;
        if (utm_campaign) leadData.campaign = utm_campaign;

        const lead = await db
          .insertInto("leads")
          .values(leadData)
          .returningAll()
          .executeTakeFirst();

        if (lead && submission) {
          await db
            .updateTable("form_submissions")
            .set({
              lead_id: lead.id,
              conversion_status: "converted",
              updated_at: new Date(),
            })
            .where("id", "=", submission.id)
            .execute();

          await db
            .updateTable("web_forms")
            .set({
              total_leads_created: form.total_leads_created + 1,
            })
            .where("id", "=", form.id)
            .execute();
        }
      }
    } catch (err: any) {
      console.warn("Failed to auto-create lead from form submission:", err.message);
      // Don't fail the submission if lead creation fails
    }

    // Increment submission count
    await db
      .updateTable("web_forms")
      .set({
        total_submissions: form.total_submissions + 1,
      })
      .where("id", "=", form.id)
      .execute();

    reply.status(201).send({
      status: 1,
      message: "Form submitted successfully",
      data: {
        submission_id: submission?.id,
        lead_created: submission?.lead_id ? true : false,
      },
    });
  } catch (error: any) {
    console.error("Form submission error:", error);
    reply.status(500).send({
      status: 0,
      message: "Failed to process form submission",
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────
// 📊 FORM SUBMISSIONS LIST
// ────────────────────────────────────────────────────────────

export const getFormSubmissions = async (
  req: FastifyRequest<{
    Querystring: {
      page?: string;
      limit?: string;
      status?: "pending" | "converted" | "failed";
    };
  }>,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;
    if (!username) {
      return reply.status(401).send({
        status: 0,
        message: "Unauthorized",
        data: null,
      });
    }

    const pageNum = Math.max(1, parseInt(req.query.page || "1", 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const offset = (pageNum - 1) * limitNum;
    const filterStatus = req.query.status;

    const form = await db
      .selectFrom("web_forms")
      .select("id")
      .where("username", "=", username)
      .executeTakeFirst();

    if (!form) {
      return reply.status(200).send({
        status: 1,
        message: "No submissions",
        data: [],
        pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 },
      });
    }

    let query = db
      .selectFrom("form_submissions")
      .selectAll()
      .where("form_id", "=", form.id);

    if (filterStatus) {
      query = query.where("conversion_status", "=", filterStatus);
    }

    const total = await query
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();

    const submissions = await query
      .orderBy("submitted_at", "desc")
      .limit(limitNum)
      .offset(offset)
      .execute();

    reply.status(200).send({
      status: 1,
      message: "Submissions retrieved",
      data: submissions.map((s) => ({
        ...s,
        custom_fields: s.custom_fields ? JSON.parse(s.custom_fields as string) : {},
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: Number(total?.count || 0),
        totalPages: Math.ceil(Number(total?.count || 0) / limitNum),
      },
    });
  } catch (error: any) {
    console.error(error);
    reply.status(500).send({
      status: 0,
      message: "Failed to fetch submissions",
      error: error.message,
    });
  }
};
