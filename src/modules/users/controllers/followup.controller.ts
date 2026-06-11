import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { canAccessLead } from "../utils/leadAccess.js";

// Helper function to sanitize text by removing emojis and problematic characters
const sanitizeText = (text: string | null | undefined): string => {
  if (!text) return '';
  // Remove emojis and other 4-byte UTF-8 characters that might cause MySQL issues
  return text.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
};

export interface ScheduleFollowUpBody {
  lead_id: number;
  scheduled_at: string;
  notes?: string;
}

export interface UpdateFollowUpBody {
  status?: string;
  notes?: string;
  scheduled_at?: string;
}

export const scheduleFollowUp = async (
  req: FastifyRequest<{ Body: ScheduleFollowUpBody }>,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;
    const tenant_id = (req.user as any)?.tenant_id;
    
    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized user",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    const { lead_id, scheduled_at, notes } = req.body;

    if (!lead_id || !scheduled_at) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "lead_id and scheduled_at are required",
        error: "validation_error",
        data: null,
        validation: null,
      });
    }

    // 🔐 ownership: the lead must belong to this user/account
    if (!(await canAccessLead(req, Number(lead_id)))) {
      return reply.status(404).send({
        status: 0, statuscode: 404, message: "Lead not found",
        error: "lead_not_found", data: null, validation: null,
      });
    }

    // Validate that follow-up date is in the future
    const followupDate = new Date(scheduled_at);
    const now = new Date();
    
    if (followupDate <= now) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Follow-up date must be in the future",
        error: "invalid_followup_date",
        data: null,
        validation: null,
      });
    }

    const lead = await db
      .selectFrom("leads")
      .select(["id", "full_name"])
      .where("id", "=", lead_id)
      .executeTakeFirst();

    if (!lead) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Lead not found",
        error: "lead_not_found",
        data: null,
        validation: null,
      });
    }

    const followUp = await db
      .insertInto("lead_followups")
      .values({
        tenant_id: tenant_id || null,
        login_username: username,
        lead_id,
        lead_name: sanitizeText(lead.full_name),
        scheduled_at: new Date(scheduled_at),
        notes: notes || null,
        status: "pending",
        created_at: new Date(),
        updated_at: new Date(),
      } as any)
      .executeTakeFirst();

    await db
      .updateTable("leads")
      .set({ next_followup_at: new Date(scheduled_at) })
      .where("id", "=", lead_id)
      .execute();

    await db
      .insertInto("lead_activities")
      .values({
        tenant_id: tenant_id || null,
        login_username: username,
        lead_id,
        lead_name: sanitizeText(lead.full_name),
        activity_type: "FOLLOWUP",
        action: "FOLLOWUP_SCHEDULED",
        status: "pending",
        source: "system",
        description: notes || `Follow-up scheduled for ${new Date(scheduled_at).toLocaleString()}`,
        metadata: JSON.stringify({ scheduled_at, notes }),
        created_at: new Date(),
        updated_at: new Date(),
      } as any)
      .execute();

    return reply.status(201).send({
      status: 1,
      statuscode: 201,
      message: "Follow-up scheduled successfully",
      error: null,
      validation: null,
      data: {
        id: Number(followUp.insertId),
        lead_id,
        scheduled_at,
        notes,
        status: "pending",
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

export const getLeadFollowUps = async (
  req: FastifyRequest<{ 
    Params: { leadId: string };
    Querystring: { page?: string; limit?: string };
  }>,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized user",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    const leadId = Number(req.params.leadId);

    // 🔐 ownership guard
    if (!(await canAccessLead(req, leadId))) {
      return reply.status(404).send({
        status: 0, statuscode: 404, message: "Lead not found",
        error: "lead_not_found", data: null, validation: null,
      });
    }

    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "10", 10);
    const offset = (page - 1) * limit;

    // Get total count
    const totalResult = await db
      .selectFrom("lead_followups")
      .select((eb) => eb.fn.countAll().as("total"))
      .where("lead_id", "=", leadId)
      .executeTakeFirst();

    const total = Number(totalResult?.total || 0);
    const totalPages = Math.ceil(total / limit);

    // Get paginated follow-ups
    const followUps = await db
      .selectFrom("lead_followups")
      .selectAll()
      .where("lead_id", "=", leadId)
      .orderBy("scheduled_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Follow-ups fetched successfully",
      error: null,
      validation: null,
      data: {
        followups: followUps,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
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

export const updateFollowUp = async (
  req: FastifyRequest<{ Params: { id: string }; Body: UpdateFollowUpBody }>,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;
    const tenant_id = (req.user as any)?.tenant_id;
    
    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized user",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    const followUpId = Number(req.params.id);
    const { status, notes, scheduled_at } = req.body;

    const existingFollowUp = await db
      .selectFrom("lead_followups")
      .selectAll()
      .where("id", "=", followUpId)
      .executeTakeFirst();

    if (!existingFollowUp) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Follow-up not found",
        error: "followup_not_found",
        data: null,
        validation: null,
      });
    }

    // 🔐 ownership: the follow-up's lead must belong to this user/account
    if (!(await canAccessLead(req, Number(existingFollowUp.lead_id)))) {
      return reply.status(404).send({
        status: 0, statuscode: 404, message: "Follow-up not found",
        error: "followup_not_found", data: null, validation: null,
      });
    }

    const updateData: any = {
      updated_at: new Date(),
    };

    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (scheduled_at) updateData.scheduled_at = new Date(scheduled_at);
    if (status === "completed") updateData.completed_at = new Date();

    await db
      .updateTable("lead_followups")
      .set(updateData)
      .where("id", "=", followUpId)
      .execute();

    // Update the leads table next_followup_at field based on the follow-up status
    if (status === "completed" || status === "cancelled") {
      // If this follow-up is completed or cancelled, find the next earliest pending follow-up
      const nextPendingFollowUp = await db
        .selectFrom("lead_followups")
        .select("scheduled_at")
        .where("lead_id", "=", existingFollowUp.lead_id)
        .where("status", "=", "pending")
        .where("id", "!=", followUpId) // Exclude the current one being updated
        .orderBy("scheduled_at", "asc")
        .executeTakeFirst();

      await db
        .updateTable("leads")
        .set({ 
          next_followup_at: nextPendingFollowUp ? new Date(nextPendingFollowUp.scheduled_at) : null 
        })
        .where("id", "=", existingFollowUp.lead_id)
        .execute();
    } else if (scheduled_at) {
      // If rescheduling (changing scheduled_at), find the earliest pending follow-up after update
      const earliestPendingFollowUp = await db
        .selectFrom("lead_followups")
        .select("scheduled_at")
        .where("lead_id", "=", existingFollowUp.lead_id)
        .where("status", "=", "pending")
        .orderBy("scheduled_at", "asc")
        .executeTakeFirst();

      await db
        .updateTable("leads")
        .set({ 
          next_followup_at: earliestPendingFollowUp ? new Date(earliestPendingFollowUp.scheduled_at) : null 
        })
        .where("id", "=", existingFollowUp.lead_id)
        .execute();
    }

    // Log activity for status change to completed
    if (status === "completed" && existingFollowUp.status !== "completed") {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id: tenant_id || existingFollowUp.tenant_id,
          login_username: username,
          lead_id: existingFollowUp.lead_id,
          lead_name: sanitizeText(existingFollowUp.lead_name),
          activity_type: "FOLLOWUP",
          action: "FOLLOWUP_COMPLETED",
          status: "completed",
          source: "system",
          description: `Follow-up completed${notes ? ': ' + notes : ''}`,
          metadata: JSON.stringify({ 
            followup_id: followUpId, 
            old_status: existingFollowUp.status,
            new_status: "completed",
            notes 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log activity for status change to cancelled
    if (status === "cancelled" && existingFollowUp.status !== "cancelled") {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id: tenant_id || existingFollowUp.tenant_id,
          login_username: username,
          lead_id: existingFollowUp.lead_id,
          lead_name: sanitizeText(existingFollowUp.lead_name),
          activity_type: "FOLLOWUP",
          action: "FOLLOWUP_CANCELLED",
          status: "cancelled",
          source: "system",
          description: `Follow-up cancelled${notes ? ': ' + notes : ''}`,
          metadata: JSON.stringify({ 
            followup_id: followUpId, 
            old_status: existingFollowUp.status,
            new_status: "cancelled",
            notes 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log activity for scheduled_at change (rescheduling)
    if (scheduled_at && new Date(scheduled_at).getTime() !== new Date(existingFollowUp.scheduled_at).getTime()) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id: tenant_id || existingFollowUp.tenant_id,
          login_username: username,
          lead_id: existingFollowUp.lead_id,
          lead_name: sanitizeText(existingFollowUp.lead_name),
          activity_type: "FOLLOWUP",
          action: "FOLLOWUP_RESCHEDULED",
          status: existingFollowUp.status,
          source: "system",
          description: `Follow-up rescheduled from ${new Date(existingFollowUp.scheduled_at).toLocaleString()} to ${new Date(scheduled_at).toLocaleString()}`,
          metadata: JSON.stringify({ 
            followup_id: followUpId, 
            old_scheduled_at: existingFollowUp.scheduled_at,
            new_scheduled_at: scheduled_at 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log activity for notes update (only if notes changed and no status change)
    if (notes !== undefined && notes !== existingFollowUp.notes && !status) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id: tenant_id || existingFollowUp.tenant_id,
          login_username: username,
          lead_id: existingFollowUp.lead_id,
          lead_name: sanitizeText(existingFollowUp.lead_name),
          activity_type: "NOTE",
          action: "FOLLOWUP_NOTES_UPDATED",
          status: existingFollowUp.status,
          source: "system",
          description: notes || "Follow-up notes updated",
          metadata: JSON.stringify({ 
            followup_id: followUpId, 
            old_notes: existingFollowUp.notes,
            new_notes: notes 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Follow-up updated successfully",
      error: null,
      validation: null,
      data: { id: followUpId, ...updateData },
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

export const getLeadActivities = async (
  req: FastifyRequest<{ Params: { leadId: string }; Querystring: { page?: string; limit?: string } }>,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized user",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    const leadId = Number(req.params.leadId);

    // 🔐 ownership guard
    if (!(await canAccessLead(req, leadId))) {
      return reply.status(404).send({
        status: 0, statuscode: 404, message: "Lead not found",
        error: "lead_not_found", data: null, validation: null,
      });
    }

    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "100", 10);
    const offset = (page - 1) * limit;

    const countResult = await db
      .selectFrom("lead_activities")
      .select((eb) => eb.fn.countAll().as("total"))
      .where("lead_id", "=", leadId)
      .executeTakeFirst();

    const total = Number(countResult?.total || 0);

    const activities = await db
      .selectFrom("lead_activities")
      .selectAll()
      .where("lead_id", "=", leadId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    // Group activities by date
    const groupedByDate: Record<string, any[]> = {};
    const activityTypeCounts: Record<string, number> = {};

    activities.forEach((activity) => {
      const date = new Date(activity.created_at || new Date()).toISOString().split('T')[0];
      if (!groupedByDate[date]) {
        groupedByDate[date] = [];
      }
      groupedByDate[date].push(activity);

      // Count activity types
      const type = activity.activity_type;
      activityTypeCounts[type] = (activityTypeCounts[type] || 0) + 1;
    });

    const totalPages = Math.ceil(total / limit);

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Activities fetched successfully",
      error: null,
      validation: null,
      data: {
        activities,
        groupedByDate,
        summary: {
          total,
          byType: activityTypeCounts,
        },
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
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
