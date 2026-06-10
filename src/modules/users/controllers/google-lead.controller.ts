import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { captureLeadSchema } from "../schema/capture-lead.schema.js";

export const captureLeadByGoogle = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // =====================================================
    // 1️⃣ VALIDATION
    // =====================================================
    const parsed = captureLeadSchema.safeParse(req.body);

    if (!parsed.success) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Validation failed",
        error: "validation_error",
        validation: parsed.error.flatten(),
        data: null,
      });
    }

    const data = parsed.data;

    // =====================================================
    // 🔐 OWNER_KEY VALIDATION (CHECK IN USER TABLE)
    // =====================================================
   
console.log("owner_key",data.owner_key)
  const ownerUser = await db
  .selectFrom("users")
  .select(["username", "tenant_id"])
  .where("owner_key", "=", data.owner_key)
  .executeTakeFirst();

if (!ownerUser) {
  return reply.status(400).send({
    status: 0,
    statuscode: 400,
    message: "Invalid owner_key",
    error: "invalid_owner_key",
    data: null,
  });
}
const username = ownerUser.username;
const tenant_id = ownerUser.tenant_id + " By Google";

    // Check if this is a duplicate (but still insert it)
    let isDuplicate = 0;
    if (data.phone || data.email) {
      let query = db
        .selectFrom("leads")
        .select(["id"])
        .where("username", "=", username);

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

    // =====================================================
    // 2️⃣ INSERT LEAD (ALLOW DUPLICATES BUT MARK THEM)
    // =====================================================
    const insertResult = await db
      .insertInto("leads")
      .values({
        tenant_id,
        first_name: data.first_name,
        last_name: data.last_name || null,
        full_name: `${data.first_name} ${data.last_name || ""}`.trim(),
        username: username,
        email: data.email || null,
        phone: data.phone || null,

        // 🔥 GOOGLE DATA (NO HARDCODE)
        source: data.utm_source || "google",
        sub_source: data.gad_source || null,
        campaign: data.utm_campaign || null,
        gclid: data.gclid || null,
        owner_id: data.assigned_agent_id || null,
        assigned_agent: data.assigned_agent_name || "unassigned",

        status: "NEW",
        lifecycle: "lead",
        is_duplicate: isDuplicate,

        created_at: new Date(),
        updated_at: new Date(),
      })
      .executeTakeFirst();

    const leadId = Number(insertResult.insertId);

    // =====================================================
    // 4️⃣ LEAD HISTORY (SOURCE TRACKING)
    // =====================================================
    const historyDescription = `Lead captured via Google Ads | campaign=${
      data.utm_campaign || "NA"
    }`;

    await db
      .insertInto("lead_history")
      .values({
        tenant_id,
        lead_id: leadId,
        field_name: "source",
        old_value: null,
        new_value: data.utm_source || "google",
        description: historyDescription,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    // =====================================================
    // 5️⃣ ACTIVITY LOG (FORM SUBMISSION)
    // =====================================================
    const activityDescription = `Lead form submitted via Google Ads`;

    await db
      .insertInto("lead_activities")
      .values({
        tenant_id,
        lead_id: leadId,
        lead_name: data.first_name,
        // actor_type: "system",
        activity_type: "FORM",
        action: "LEAD_CREATED",
        status: "submitted",
        source: data.utm_source || "google",
        description: activityDescription,
        metadata: JSON.stringify({
          gclid: data.gclid,
          utm_campaign: data.utm_campaign,
          gad_source: data.gad_source,
        }),
        created_at: new Date(),
      })
      .execute();

    // =====================================================
    // ✅ RESPONSE
    // =====================================================
    return reply.status(201).send({
      status: 1,
      statuscode: 201,
      message: "Lead captured successfully",
      data: {
        lead_id: leadId,
        is_duplicate: isDuplicate === 1,
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
    });
  }
};

// import { FastifyRequest, FastifyReply } from "fastify";
// import { captureLeadSchema } from "../schema/capture-lead.schema";
// import { normalizeGoogleLead } from "../adapterIntrigation/google.adapter";
// import { leadService } from "../adapterIntrigation/leadServices";

// export const captureLeadByGoogle = async (
//   req: FastifyRequest,
//   reply: FastifyReply
// ) => {
//   try {
//     // =====================================================
//     // 1️⃣ VALIDATION (ZOD)
//     // =====================================================
//     const parsed = captureLeadSchema.safeParse(req.body);

//     if (!parsed.success) {
//       return reply.status(400).send({
//         status: 0,
//         statuscode: 400,
//         message: "Validation failed",
//         error: "validation_error",
//         validation: parsed.error.flatten(),
//         data: null,
//       });
//     }

//     // Raw form + google params
//     const rawData = parsed.data;

//     // =====================================================
//     // 2️⃣ ADAPT GOOGLE DATA → COMMON LEAD FORMAT
//     // =====================================================
//     const normalizedLead = normalizeGoogleLead(rawData);
//     /**
//      * normalizedLead will contain:
//      * {
//      *  tenant_id,
//      *  owner_username,
//      *  first_name,
//      *  last_name,
//      *  email,
//      *  phone,
//      *  source,
//      *  medium,
//      *  campaign,
//      *  term,
//      *  content,
//      *  gclid,
//      *  landing_page
//      * }
//      */

//     // =====================================================
//     // 3️⃣ SEND TO COMMON LEAD SERVICE
//     // =====================================================
//     const result = await leadService.captureLead(normalizedLead);

//     // =====================================================
//     // 4️⃣ RESPONSE
//     // =====================================================

//     return reply.status(result.data.duplicate ? 200 : 201).send({
//   status: 1,
//   statuscode: result.data.duplicate ? 200 : 201,
//   message: result.data.duplicate
//     ? "Duplicate lead detected"
//     : "Lead captured successfully",
//   error: null,
//   validation: null,
//   data: {
//     lead_id: result.data.lead_id,
//     duplicate: result.data.duplicate,
//   },
// });

//   } catch (error) {
//     req.log.error(error);
//     return reply.status(500).send({
//       status: 0,
//       statuscode: 500,
//       message: "Internal server error",

//       error: "server_error",
//       validation: null,
//       data: null,
//     });
//   }
// };
