import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { canAccessLead } from "../utils/leadAccess.js";

export interface CommunicationData {
  whatsapp: {
    total_messages: number;
    sent: number;
    received: number;
    read: number;
    failed: number;
    recent_messages: Array<{
      id: number;
      message: string;
      direction: string;
      status: string;
      created_at: string;
      message_type: string;
      source: string; // 'chat' or 'campaign'
    }>;
  };
  email: {
    total_sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    failed: number;
    recent_emails: Array<{
      id: number;
      description: string;
      status: string;
      created_at: string;
      action: string;
    }>;
  };
  sms: {
    total_sent: number;
    delivered: number;
    failed: number;
    recent_sms: Array<{
      id: number;
      description: string;
      status: string;
      created_at: string;
      direction: string;
    }>;
  };
}

export const getLeadCommunication = async (
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

    // 🔐 ownership guard — communication history is sensitive (chats, emails, SMS)
    if (!(await canAccessLead(req, leadId))) {
      return reply.status(404).send({
        status: 0, statuscode: 404, message: "Lead not found",
        error: "lead_not_found", data: null, validation: null,
      });
    }

    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "20", 10);
    const offset = (page - 1) * limit;

    // Get lead details to find phone and email
    const lead = await db
      .selectFrom("leads")
      .select(["phone", "email", "country_code"])
      .where("id", "=", leadId)
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

    // Construct phone number for WhatsApp lookup
    const phoneNumber = lead.country_code && lead.phone 
      ? `${lead.country_code}${lead.phone}` 
      : lead.phone;

    // Get WhatsApp communication data
    let whatsappData: {
      total_messages: number;
      sent: number;
      received: number;
      read: number;
      failed: number;
      recent_messages: Array<{
        id: number;
        message: string;
        direction: string;
        status: string;
        created_at: string;
        message_type: string;
        source: string;
      }>;
    } = {
      total_messages: 0,
      sent: 0,
      received: 0,
      read: 0,
      failed: 0,
      recent_messages: [],
    };

    if (phoneNumber) {
      // Get WhatsApp chat messages with pagination
      const whatsappMessages = await db
        .selectFrom("chat_messages")
        .selectAll()
        .where((eb) => eb.or([
          eb("sender_id", "=", phoneNumber),
          eb("receiver_id", "=", phoneNumber)
        ]))
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset)
        .execute();

      // Get WhatsApp campaign messages with pagination
      const campaignMessages = await db
        .selectFrom("whatsapp_camp_details" as any)
        .selectAll()
        .where("receiver", "=", phoneNumber)
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset)
        .execute();

      // Get total counts for pagination
      const totalChatMessages = await db
        .selectFrom("chat_messages")
        .select((eb) => eb.fn.countAll().as("total"))
        .where((eb) => eb.or([
          eb("sender_id", "=", phoneNumber),
          eb("receiver_id", "=", phoneNumber)
        ]))
        .executeTakeFirst();

      const totalCampaignMessages = await db
        .selectFrom("whatsapp_camp_details" as any)
        .select((eb) => eb.fn.countAll().as("total"))
        .where("receiver", "=", phoneNumber)
        .executeTakeFirst();

      // Combine and process all WhatsApp messages
      const allWhatsappMessages = [
        ...whatsappMessages.map(m => ({
          id: m.id || 0,
          message: m.text || "",
          direction: m.direction || "",
          status: m.status || "",
          created_at: m.created_at?.toISOString() || "",
          message_type: m.type || "text",
          source: "chat" as const,
        })),
        ...campaignMessages.map((c: any) => ({
          id: c.id || 0,
          message: `Campaign: ${c.name || 'WhatsApp Campaign'} (Template: ${c.template_id || 'N/A'})`,
          direction: "outbound",
          status: c.status || "pending",
          created_at: c.created_at?.toISOString() || "",
          message_type: "template",
          source: "campaign" as const,
        })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const totalWhatsappMessages = Number(totalChatMessages?.total || 0) + Number(totalCampaignMessages?.total || 0);

      whatsappData = {
        total_messages: totalWhatsappMessages,
        sent: allWhatsappMessages.filter(m => m.direction === "outbound").length,
        received: allWhatsappMessages.filter(m => m.direction === "inbound").length,
        read: allWhatsappMessages.filter(m => m.status === "read").length,
        failed: allWhatsappMessages.filter(m => m.status === "failed").length,
        recent_messages: allWhatsappMessages,
      };
    }

    // Get Email communication data from lead_activities with pagination
    const emailActivities = await db
      .selectFrom("lead_activities")
      .selectAll()
      .where("lead_id", "=", leadId)
      .where("activity_type", "=", "EMAIL")
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    const totalEmailActivities = await db
      .selectFrom("lead_activities")
      .select((eb) => eb.fn.countAll().as("total"))
      .where("lead_id", "=", leadId)
      .where("activity_type", "=", "EMAIL")
      .executeTakeFirst();

    const emailData = {
      total_sent: Number(totalEmailActivities?.total || 0),
      delivered: emailActivities.filter(a => a.status === "delivered").length,
      opened: emailActivities.filter(a => a.status === "opened").length,
      clicked: emailActivities.filter(a => a.status === "clicked").length,
      bounced: emailActivities.filter(a => a.status === "bounced").length,
      failed: emailActivities.filter(a => a.status === "failed").length,
      recent_emails: emailActivities.map(a => ({
        id: a.id || 0,
        description: a.description || "",
        status: a.status || "",
        created_at: a.created_at?.toISOString() || "",
        action: a.action || "",
      })),
    };

    // Get SMS communication data from lead_activities with pagination
    const smsActivities = await db
      .selectFrom("lead_activities")
      .selectAll()
      .where("lead_id", "=", leadId)
      .where("activity_type", "=", "SMS")
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    const totalSmsActivities = await db
      .selectFrom("lead_activities")
      .select((eb) => eb.fn.countAll().as("total"))
      .where("lead_id", "=", leadId)
      .where("activity_type", "=", "SMS")
      .executeTakeFirst();

    const smsData = {
      total_sent: Number(totalSmsActivities?.total || 0),
      delivered: smsActivities.filter(a => a.status === "delivered").length,
      failed: smsActivities.filter(a => a.status === "failed").length,
      recent_sms: smsActivities.map(a => ({
        id: a.id || 0,
        description: a.description || "",
        status: a.status || "",
        created_at: a.created_at?.toISOString() || "",
        direction: a.direction || "",
      })),
    };

    const totalMessages = whatsappData.total_messages + emailData.total_sent + smsData.total_sent;
    const totalPages = Math.ceil(totalMessages / limit);

    const communicationData: CommunicationData = {
      whatsapp: whatsappData,
      email: emailData,
      sms: smsData,
    };

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Communication data fetched successfully",
      error: null,
      validation: null,
      data: {
        ...communicationData,
        pagination: {
          page,
          limit,
          total: totalMessages,
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