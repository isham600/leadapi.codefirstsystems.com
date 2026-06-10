import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { z } from "zod";
import { notify, getUuidByUsername } from "../../../utils/notify.js";

// Validation schema for lead creation
const createLeadSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().optional(),
  email: z.string().email("Invalid email address").optional(),
  phone: z.string().optional(),
  country_code: z.string().optional(),
  city: z.string().optional(),
  status: z.string().default("New"),
  priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
  source: z.string().default("manual"),
  sub_source: z.string().optional(),
  campaign: z.string().optional(),
  assigned_agent_id: z.string().optional(),
  assigned_agent_name: z.string().optional(),
  user_type: z.string().optional(),
});

export const createLead = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // Get username from authenticated user
    const owner_username = req.user?.username;
    const tenant_id = (req.user as any)?.tenant_id;

    if (!owner_username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized user",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    // Validate request body
    const parsed = createLeadSchema.safeParse(req.body);

    if (!parsed.success) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Validation failed",
        error: "validation_error",
        data: null,
        validation: parsed.error.flatten(),
      });
    }

    const data = parsed.data;

    // Check if this is a duplicate (but still insert it)
    let isDuplicate = 0;
    if (data.phone || data.email) {
      let query = db
        .selectFrom("leads")
        .select(["id"])
        .where("username", "=", owner_username);

      // Build OR condition for phone or email match
      if (data.phone && data.email) {
        query = query.where((eb) =>
          eb.or([
            eb("phone", "=", data.phone),
            eb("email", "=", data.email)
          ])
        );
      } else if (data.phone) {
        query = query.where("phone", "=", data.phone);
      } else if (data.email) {
        query = query.where("email", "=", data.email);
      }

      const existingLead = await query.executeTakeFirst();
      if (existingLead) {
        isDuplicate = 1;
      }
    }

    // Create full name
    const full_name = [data.first_name, data.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    // Insert new lead (allow duplicates but mark them)
    const insertResult = await db
      .insertInto("leads")
      .values({
        username: owner_username,
        tenant_id: tenant_id || null,
        first_name: data.first_name,
        last_name: data.last_name || null,
        full_name,
        email: data.email || null,
        phone: data.phone || null,
        country_code: data.country_code || null,
        city: data.city || null,
        status: data.status,
        lifecycle: "lead",
        priority: data.priority,
        source: data.source,
        sub_source: data.sub_source || null,
        campaign: data.campaign || null,
        owner_id: data.assigned_agent_id || null,
        assigned_agent: data.assigned_agent_name || "unassigned",
        user_type: data.user_type || null,
        is_duplicate: isDuplicate,
        is_converted: 0,
        is_archived: 0,
        lead_score: 0,
        created_by: owner_username,
        updated_by: owner_username,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .executeTakeFirst();

    const leadId = Number(insertResult.insertId);

    // Insert lead history
    await db
      .insertInto("lead_history")
      .values({
        tenant_id: tenant_id || null,
        lead_id: leadId,
        field_name: "status",
        old_value: null,
        new_value: data.status,
        description: `Lead created via ${data.source}`,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    // Insert lead activity
    await db
      .insertInto("lead_activities")
      .values({
        tenant_id: tenant_id || null,
        lead_id: leadId,
        lead_name: full_name,
        activity_type: "FORM",
        action: "LEAD_CREATED",
        status: "submitted",
        source: data.source,
        description: "Lead created successfully",
        metadata: JSON.stringify({
          campaign: data.campaign,
          source: data.source,
          sub_source: data.sub_source,
          assigned_agent_id: data.assigned_agent_id,
          assigned_agent_name: data.assigned_agent_name,
        }),
        created_at: new Date(),
      })
      .execute();

    // Notify admin (owner) about new lead
    const ownerUuid = await getUuidByUsername(owner_username);
    notify({
      username: owner_username,
      uuid:     ownerUuid ?? undefined,
      type:     "new_lead",
      title:    `New lead: ${full_name}`,
      description: `Source: ${data.source}${data.assigned_agent_name ? ` · Assigned to ${data.assigned_agent_name}` : ""}`,
      link:     `/lead-manager?id=${leadId}`,
    });
    // Also notify assigned agent if different from owner
    if (data.assigned_agent_name && data.assigned_agent_name !== "unassigned" && data.assigned_agent_name !== owner_username) {
      const agentUuid = await getUuidByUsername(data.assigned_agent_name);
      notify({
        username: data.assigned_agent_name,
        uuid:     agentUuid ?? undefined,
        type:     "assigned",
        title:    `Lead assigned to you: ${full_name}`,
        description: `Source: ${data.source}`,
        link:     `/lead-manager?id=${leadId}`,
      });
    }

    return reply.status(201).send({
      status: 1,
      statuscode: 201,
      message: "Lead created successfully",
      error: null,
      validation: null,
      data: {
        lead_id: leadId,
        full_name,
        is_duplicate: isDuplicate === 1,
      },
    });
  } catch (error: any) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Server error",
      error: "server_error",
      data: null,
      validation: null,
    });
  }
};
