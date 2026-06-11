import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { notify, getUuidByUsername } from "../../../utils/notify.js";
import { sendMetaCapiLeadEvent } from "../../meta/services/meta-lead.service.js";

// Helper function to sanitize text by removing emojis and problematic characters
const sanitizeText = (text: string | null | undefined): string => {
  if (!text) return '';
  // Remove emojis and other 4-byte UTF-8 characters that might cause MySQL issues
  return text.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
};

export interface UpdateLeadBody {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  city?: string;
  status?: string;
  priority?: string;
  assigned_agent?: string;
  notes?: string;
  next_followup_at?: string;
  followup_notes?: string; // Specific notes for the follow-up
  // Pipeline-specific fields
  value?: number;
  expectedCloseDate?: string;
  source?: string;
}

export const updateLead = async (
  req: FastifyRequest<{ Params: { id: string }; Body: UpdateLeadBody }>,
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

    const leadId = Number(req.params.id);
    const updateData = req.body;

    // ── Agent hierarchy: agents (user_type=5) own no leads directly — their
    // leads live under the parent's username and are restricted to the ones
    // assigned to them. Without this, agents 404 on leads they can see.
    const userType = (req.user as any)?.user_type as number | undefined;
    let accountUsername: string = username;
    let agentFilter: string | null = null;
    if (userType === 5) {
      const parentRow: any = await (db as any)
        .selectFrom("users")
        .select(["parent_username"])
        .where("username", "=", username)
        .executeTakeFirst();
      accountUsername = parentRow?.parent_username ?? username;
      agentFilter     = username;
    }

    // Check if lead exists (scoped to the account, and to the agent if one)
    let existingQuery = db
      .selectFrom("leads")
      .selectAll()
      .where("id", "=", leadId)
      .where("username", "=", accountUsername);
    if (agentFilter) {
      existingQuery = existingQuery.where("assigned_agent", "=", agentFilter);
    }
    const existingLead = await existingQuery.executeTakeFirst();

    if (!existingLead) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Lead not found",
        error: "lead_not_found",
        data: null,
        validation: null,
      });
    }

    // Prepare update object
    const updateFields: any = {
      updated_at: new Date(),
      updated_by: username,
    };

    if (updateData.first_name !== undefined) updateFields.first_name = updateData.first_name;
    if (updateData.last_name !== undefined) updateFields.last_name = updateData.last_name;
    if (updateData.full_name !== undefined) updateFields.full_name = updateData.full_name;
    if (updateData.email !== undefined) updateFields.email = updateData.email;
    if (updateData.phone !== undefined) updateFields.phone = updateData.phone;
    if (updateData.city !== undefined) updateFields.city = updateData.city;
    if (updateData.status !== undefined) updateFields.status = updateData.status;
    if (updateData.priority !== undefined) updateFields.priority = updateData.priority;
    if (updateData.assigned_agent !== undefined) updateFields.assigned_agent = updateData.assigned_agent;
    if (updateData.next_followup_at !== undefined) {
      updateFields.next_followup_at = updateData.next_followup_at ? new Date(updateData.next_followup_at) : null;
    }
    
    // Pipeline-specific fields
    if (updateData.value !== undefined) updateFields.lead_value = updateData.value.toString();
    if (updateData.expectedCloseDate !== undefined) updateFields.close_date = updateData.expectedCloseDate;
    if (updateData.source !== undefined) updateFields.source = updateData.source;

    console.log("Update fields:", updateFields); // Debug log

    // Update the lead (scoped to the resolved account)
    await db
      .updateTable("leads")
      .set(updateFields)
      .where("id", "=", leadId)
      .where("username", "=", accountUsername)
      .execute();

    const tenant_id = (req.user as any)?.tenant_id || null;

    // Log stage change
    if (updateData.status && updateData.status !== existingLead.status) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "STAGE_CHANGE",
          action: "STAGE_CHANGED",
          status: "completed",
          source: "system",
          description: `Stage changed from ${existingLead.status} to ${updateData.status}`,
          metadata: JSON.stringify({
            from: existingLead.status,
            to: updateData.status
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Notify on status change
    if (updateData.status && updateData.status !== existingLead.status) {
      const ownerUuid = await getUuidByUsername(username);
      notify({
        username,
        uuid:     ownerUuid ?? undefined,
        type:     "status_change",
        title:    `Lead status updated: ${existingLead.full_name}`,
        description: `${existingLead.status} → ${updateData.status}`,
        link:     `/lead-manager?id=${leadId}`,
      });

      // Conversions API: feed the status change back to Meta (fire-and-forget,
      // no-ops unless this is a Meta lead and a pixel/dataset ID is configured)
      sendMetaCapiLeadEvent(username, Number(leadId), updateData.status).catch(() => {});
    }

    // Notify on assignment change
    if (updateData.assigned_agent && updateData.assigned_agent !== existingLead.assigned_agent && updateData.assigned_agent !== "unassigned") {
      const agentUuid = await getUuidByUsername(updateData.assigned_agent);
      notify({
        username: updateData.assigned_agent,
        uuid:     agentUuid ?? undefined,
        type:     "assigned",
        title:    `Lead assigned to you: ${existingLead.full_name}`,
        description: `Assigned by ${username}`,
        link:     `/lead-manager?id=${leadId}`,
      });
    }

    // Log status change
    if (updateData.status && updateData.status !== existingLead.status) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "STATUS_CHANGED",
          status: "completed",
          source: "system",
          description: `Status changed from ${existingLead.status} to ${updateData.status}`,
          metadata: JSON.stringify({ 
            from: existingLead.status, 
            to: updateData.status 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log priority change
    if (updateData.priority && updateData.priority !== existingLead.priority) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "PRIORITY_CHANGED",
          status: "completed",
          source: "system",
          description: `Priority changed from ${existingLead.priority || 'None'} to ${updateData.priority}`,
          metadata: JSON.stringify({ 
            from: existingLead.priority, 
            to: updateData.priority 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log assigned agent change
    if (updateData.assigned_agent && updateData.assigned_agent !== existingLead.assigned_agent) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "AGENT_ASSIGNED",
          status: "completed",
          source: "system",
          description: `Assigned to ${updateData.assigned_agent}`,
          metadata: JSON.stringify({ 
            from: existingLead.assigned_agent, 
            to: updateData.assigned_agent 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log email change
    if (updateData.email && updateData.email !== existingLead.email) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "EMAIL_UPDATED",
          status: "completed",
          source: "system",
          description: `Email updated to ${updateData.email}`,
          metadata: JSON.stringify({ 
            from: existingLead.email, 
            to: updateData.email 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log phone change
    if (updateData.phone && updateData.phone !== existingLead.phone) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "PHONE_UPDATED",
          status: "completed",
          source: "system",
          description: `Phone updated to ${updateData.phone}`,
          metadata: JSON.stringify({ 
            from: existingLead.phone, 
            to: updateData.phone 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log name change
    if (updateData.full_name && updateData.full_name !== existingLead.full_name) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "NAME_UPDATED",
          status: "completed",
          source: "system",
          description: `Name updated to ${updateData.full_name}`,
          metadata: JSON.stringify({ 
            from: existingLead.full_name, 
            to: updateData.full_name 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log city change
    if (updateData.city && updateData.city !== existingLead.city) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "CITY_UPDATED",
          status: "completed",
          source: "system",
          description: `City updated to ${updateData.city}`,
          metadata: JSON.stringify({ 
            from: existingLead.city, 
            to: updateData.city 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log value change
    if (updateData.value !== undefined && updateData.value.toString() !== (existingLead.lead_value || '')) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "VALUE_UPDATED",
          status: "completed",
          source: "system",
          description: `Deal value updated to ${updateData.value}`,
          metadata: JSON.stringify({ 
            from: existingLead.lead_value, 
            to: updateData.value.toString() 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log close date change
    if (updateData.expectedCloseDate !== undefined && updateData.expectedCloseDate !== (existingLead.close_date ? existingLead.close_date.toString() : null)) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "CLOSE_DATE_UPDATED",
          status: "completed",
          source: "system",
          description: updateData.expectedCloseDate 
            ? `Close date updated to ${new Date(updateData.expectedCloseDate).toLocaleDateString()}`
            : "Close date removed",
          metadata: JSON.stringify({ 
            from: existingLead.close_date, 
            to: updateData.expectedCloseDate 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log source change
    if (updateData.source && updateData.source !== existingLead.source) {
      await db
        .insertInto("lead_activities")
        .values({
          tenant_id,
          login_username: username,
          lead_id: leadId,
          lead_name: sanitizeText(existingLead.full_name),
          activity_type: "NOTE",
          action: "SOURCE_UPDATED",
          status: "completed",
          source: "system",
          description: `Source updated to ${updateData.source}`,
          metadata: JSON.stringify({ 
            from: existingLead.source, 
            to: updateData.source 
          }),
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .execute();
    }

    // Log followup date change and insert into lead_followups table
    if (updateData.next_followup_at !== undefined) {
      const oldDate = existingLead.next_followup_at ? new Date(existingLead.next_followup_at).toLocaleString() : null;
      const newDate = updateData.next_followup_at ? new Date(updateData.next_followup_at).toLocaleString() : null;
      
      // Validate that follow-up date is in the future
      if (updateData.next_followup_at) {
        const followupDate = new Date(updateData.next_followup_at);
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
      }
      
      if (oldDate !== newDate) {
        // Determine if this is a new schedule or removal
        const isNewSchedule = !oldDate && newDate;
        const isRemoval = oldDate && !newDate;
        
        // Log activity
        await db
          .insertInto("lead_activities")
          .values({
            tenant_id,
            login_username: username,
            lead_id: leadId,
            lead_name: sanitizeText(existingLead.full_name),
            activity_type: "FOLLOWUP",
            action: isRemoval ? "FOLLOWUP_REMOVED" : (isNewSchedule ? "FOLLOWUP_SCHEDULED" : "FOLLOWUP_RESCHEDULED"),
            status: "pending",
            source: "system",
            description: isRemoval 
              ? `Follow-up removed`
              : isNewSchedule
                ? `Follow-up scheduled for ${newDate}${updateData.followup_notes ? ': ' + updateData.followup_notes : ''}`
                : `Follow-up rescheduled to ${newDate}${updateData.followup_notes ? ': ' + updateData.followup_notes : ''}`,
            metadata: JSON.stringify({ 
              from: oldDate, 
              to: newDate,
              scheduled_at: updateData.next_followup_at
            }),
            created_at: new Date(),
            updated_at: new Date(),
          } as any)
          .execute();

        // First, cancel any existing pending follow-ups for this lead
        if (oldDate) {
          await db
            .updateTable("lead_followups")
            .set({
              status: "cancelled",
              updated_at: new Date(),
            })
            .where("lead_id", "=", leadId)
            .where("status", "=", "pending")
            .execute();
        }

        // Insert new follow-up entry if scheduled
        if (updateData.next_followup_at) {
          await db
            .insertInto("lead_followups")
            .values({
              tenant_id,
              login_username: username,
              lead_id: leadId,
              lead_name: sanitizeText(existingLead.full_name),
              scheduled_at: new Date(updateData.next_followup_at),
              notes: updateData.followup_notes || null,
              status: "pending",
              created_at: new Date(),
              updated_at: new Date(),
            } as any)
            .execute();
        }
      }
    }

    // Fetch updated lead
    const updatedLead = await db
      .selectFrom("leads")
      .selectAll()
      .where("id", "=", leadId)
      .executeTakeFirst();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Lead updated successfully",
      error: null,
      validation: null,
      data: updatedLead,
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
