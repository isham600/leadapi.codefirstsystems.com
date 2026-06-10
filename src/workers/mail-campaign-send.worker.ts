import { Worker, Job } from "bullmq";
import { sql } from "kysely";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db } from "../models/db.js";
import { redisConnection } from "../queues/campaign.queue.js";
import type { MailSendJobData } from "../queues/mail-campaign.queue.js";

const BATCH_SIZE = 50;  // rows to claim + send per iteration

// ── Variable substitution ─────────────────────────────────────
// Replaces {{key}} in text with values from vars map
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// ── Build nodemailer transporter from SMTP account row ────────
function buildTransporter(account: any): Transporter {
  const secure = account.encryption === "ssl";
  return nodemailer.createTransport({
    host:   account.smtp_host,
    port:   Number(account.smtp_port),
    secure,
    auth: {
      user: account.smtp_user,
      pass: account.smtp_password,
    },
    tls: account.encryption === "none"
      ? { rejectUnauthorized: false }
      : undefined,
  });
}
// ── Activity logging functions ────────────────────────────────

interface EmailActivityParams {
  username: string;
  campaignId: string;
  email: string;
  recipientName?: string | null;
  subject: string;
  status: "sent" | "failed";
  action: "EMAIL_SENT" | "EMAIL_FAILED";
  errorMessage?: string;
}

interface LeadEmailActivityParams {
  username: string;
  email: string;
  recipientName?: string | null;
  subject: string;
  campaignId: string;
  status: "sent" | "failed";
  errorMessage?: string;
}

/**
 * Log email activity to activity_log table
 */
async function logEmailActivity(params: EmailActivityParams): Promise<void> {
  try {
    const metadata = {
      campaign_id: params.campaignId,
      recipient_email: params.email,
      recipient_name: params.recipientName,
      subject: params.subject,
      ...(params.errorMessage && { error_message: params.errorMessage })
    };

    await (db as any)
      .insertInto("activity_log")
      .values({
        username: params.username,
        uuid: null,
        action: params.action,
        description: `Email ${params.status} to ${params.email} - Campaign: ${params.campaignId}`,
        ip_address: "system",
        device_info: JSON.stringify({
          source: "email_campaign_worker",
          campaign_id: params.campaignId,
          status: params.status
        }),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
  } catch (error) {
    console.error("Error logging email activity:", error);
  }
}

/**
 * Log email activity to lead_activities table if email matches a lead
 */
async function logLeadEmailActivity(params: LeadEmailActivityParams): Promise<void> {
  try {
    // Try to find a lead with matching email
    const lead: any = await (db as any)
      .selectFrom("leads")
      .select(["id", "full_name", "tenant_id", "email"])
      .where("email", "=", params.email)
      .where("username", "=", params.username)
      .executeTakeFirst();

    console.log(`[logLeadEmailActivity] Looking for lead with email: ${params.email}, username: ${params.username}`);
    console.log(`[logLeadEmailActivity] Found lead:`, lead);

    if (lead) {
      const metadata = {
        campaign_id: params.campaignId,
        subject: params.subject,
        email_status: params.status,
        recipient_email: params.email,
        ...(params.errorMessage && { error_message: params.errorMessage })
      };

      // Sanitize lead name to remove emojis and special characters that might cause encoding issues
      const sanitizedLeadName = lead.full_name
        ? lead.full_name.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '')
            .trim()
        : 'Unknown';

      const leadActivityData = {
        tenant_id: lead.tenant_id,
        login_username: params.username,
        login_user_type: null,
        lead_id: lead.id,
        lead_name: sanitizedLeadName,
        activity_type: "EMAIL",
        action: params.status === "sent" ? "EMAIL_SENT" : "EMAIL_FAILED",
        status: params.status,
        source: "outbound",
        description: `Email campaign sent: ${params.subject}`,
        direction: "outbound",
        channel: "email",
        metadata: JSON.stringify(metadata),
        ip_address: "system",
        user_agent: "email_campaign_worker",
        created_at: new Date(),
        updated_at: new Date(),
      };

      console.log(`[logLeadEmailActivity] Inserting lead activity:`, leadActivityData);

      await (db as any)
        .insertInto("lead_activities")
        .values(leadActivityData)
        .execute();

      console.log(`[logLeadEmailActivity] Successfully logged lead activity for lead ID: ${lead.id}`);
    } else {
      console.log(`[logLeadEmailActivity] No lead found with email: ${params.email} and username: ${params.username}`);
      
      // Let's also try to find any lead with this email regardless of username for debugging
      const anyLead: any = await (db as any)
        .selectFrom("leads")
        .select(["id", "full_name", "tenant_id", "email", "username"])
        .where("email", "=", params.email)
        .executeTakeFirst();
      
      if (anyLead) {
        console.log(`[logLeadEmailActivity] Found lead with same email but different username:`, anyLead);
      } else {
        console.log(`[logLeadEmailActivity] No lead found with email: ${params.email} at all`);
      }
    }
  } catch (error) {
    console.error("Error logging lead email activity:", error);
    console.error("Error details:", error);
  }
}

// ── Main job processor ────────────────────────────────────────
async function processSendJob(job: Job<MailSendJobData>): Promise<{ sent: number; failed: number }> {
  const { campaignId, username } = job.data;

  // ── 1. Load campaign meta (subject, body, smtp account) ───
  const campaign: any = await (db as any)
    .selectFrom("mail_camp_summary")
    .selectAll()
    .where("campaign_id", "=", campaignId)
    .where("username",    "=", username)
    .executeTakeFirst();

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  // ── 2. Load SMTP credentials ───────────────────────────────
  const smtpAccount: any = await (db as any)
    .selectFrom("mail_smtp_accounts")
    .selectAll()
    .where("id",       "=", campaign.smtp_account_id)
    .where("username", "=", username)
    .where("status",   "=", "active")
    .executeTakeFirst();

  if (!smtpAccount) {
    throw new Error(`SMTP account not found or inactive: id=${campaign.smtp_account_id}`);
  }

  const transporter = buildTransporter(smtpAccount);

  let totalSent   = 0;
  let totalFailed = 0;

  // ── 3. Process in batches until no more pp1 rows ──────────
  while (true) {
    // Atomically claim a batch: pp1 → sending
    await (db as any).executeQuery(
      sql`UPDATE mail_camp_details
          SET    status = 'sending'
          WHERE  campaign_id = ${campaignId}
            AND  status      = 'pp1'
          LIMIT  ${BATCH_SIZE}`.compile((db as any))
    );

    // Fetch the rows we just claimed
    const batch: any[] = await (db as any)
      .selectFrom("mail_camp_details")
      .select(["id", "email", "recipient_name", "custom_vars"])
      .where("campaign_id", "=", campaignId)
      .where("status",      "=", "sending")
      .limit(BATCH_SIZE)
      .execute();

    if (batch.length === 0) break;

    let batchSent   = 0;
    let batchFailed = 0;

    for (const row of batch) {
      const now = new Date();

      // Parse custom variables (stored as JSON string or object)
      let vars: Record<string, string> = {};
      if (row.recipient_name) vars["name"] = row.recipient_name;
      if (row.custom_vars) {
        try {
          const parsed = typeof row.custom_vars === "string"
            ? JSON.parse(row.custom_vars)
            : row.custom_vars;
          vars = { ...vars, ...parsed };
        } catch { /* ignore bad JSON */ }
      }

      // Build personalized subject and body
      const subject  = interpolate(campaign.subject,   vars);
      const htmlBody = interpolate(campaign.body_html,  vars);
      const textBody = campaign.body_text
        ? interpolate(campaign.body_text, vars)
        : undefined;

      // Build attachment if present
      const attachments = campaign.attachment_path
        ? [{ filename: campaign.attachment_name ?? "attachment", path: process.cwd() + campaign.attachment_path }]
        : [];

      try {
        await transporter.sendMail({
          from:        `"${campaign.from_name}" <${campaign.from_email}>`,
          to:          row.email,
          subject,
          html:        htmlBody,
          text:        textBody,
          attachments,
        });

        await (db as any)
          .updateTable("mail_camp_details")
          .set({ status: "sent", sent_at: now, error_message: null })
          .where("id", "=", row.id)
          .execute();

        // ── Log successful email send to activity_log ──────────
        await logEmailActivity({
          username,
          campaignId,
          email: row.email,
          recipientName: row.recipient_name,
          subject,
          status: "sent",
          action: "EMAIL_SENT"
        });

        // ── Try to log to lead_activities if email matches a lead ──
        await logLeadEmailActivity({
          username,
          email: row.email,
          recipientName: row.recipient_name,
          subject,
          campaignId,
          status: "sent"
        });

        batchSent++;
      } catch (err: any) {
        const errMsg = String(err?.message ?? err).slice(0, 500);

        await (db as any)
          .updateTable("mail_camp_details")
          .set({ status: "failed", error_message: errMsg })
          .where("id", "=", row.id)
          .execute();

        // ── Log failed email send to activity_log ──────────────
        await logEmailActivity({
          username,
          campaignId,
          email: row.email,
          recipientName: row.recipient_name,
          subject,
          status: "failed",
          action: "EMAIL_FAILED",
          errorMessage: errMsg
        });

        // ── Try to log to lead_activities if email matches a lead ──
        await logLeadEmailActivity({
          username,
          email: row.email,
          recipientName: row.recipient_name,
          subject,
          campaignId,
          status: "failed",
          errorMessage: errMsg
        });

        batchFailed++;
        console.error(`[mailSend] ${row.email} FAILED: ${errMsg}`);
      }
    }

    totalSent   += batchSent;
    totalFailed += batchFailed;

    // Update summary counters atomically
    await (db as any).executeQuery(
      sql`UPDATE mail_camp_summary
          SET sent_count   = sent_count   + ${batchSent},
              failed_count = failed_count + ${batchFailed},
              updated_at   = NOW()
          WHERE campaign_id = ${campaignId}`.compile((db as any))
    );

    // Report progress to BullMQ
    const processed = totalSent + totalFailed;
    if (campaign.total > 0) {
      await job.updateProgress(Math.min(99, Math.round((processed / campaign.total) * 100)));
    }

    console.log(`[mailSend] ${campaignId} batch done — sent: ${batchSent}, failed: ${batchFailed}`);
  }

  // ── 4. Mark campaign as completed ─────────────────────────
  const finalStatus = totalFailed === 0 ? "completed" : "completed";  // always completed
  await (db as any)
    .updateTable("mail_camp_summary")
    .set({ status: finalStatus, updated_at: new Date() })
    .where("campaign_id", "=", campaignId)
    .execute();

  await job.updateProgress(100);
  console.log(`[mailSend] campaign ${campaignId} DONE — sent: ${totalSent}, failed: ${totalFailed}`);

  return { sent: totalSent, failed: totalFailed };
}


// ── Export starter ─────────────────────────────────────────────

export function startMailSendWorker() {
  const worker = new Worker<MailSendJobData>(
    "mail-campaign-send",
    processSendJob,
    {
      connection:  redisConnection as any,
      concurrency: 3,   // 3 campaigns sending in parallel
    }
  );

  worker.on("completed", (job, result) => {
    console.log(
      `[mailSend] job ${job.id} campaign=${job.data.campaignId} ` +
      `— sent: ${result.sent}, failed: ${result.failed}`
    );
  });

  worker.on("failed", async (job, err) => {
    console.error(`[mailSend] job ${job?.id} FAILED:`, err.message);
    if (job?.data?.campaignId) {
      await (db as any)
        .updateTable("mail_camp_summary")
        .set({ status: "failed", updated_at: new Date() })
        .where("campaign_id", "=", job.data.campaignId)
        .execute()
        .catch(() => {});
    }
  });

  console.log("[mailSend] worker started — concurrency: 3");
  return worker;
}
