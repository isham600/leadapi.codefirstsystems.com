import type { FastifyRequest, FastifyReply } from "fastify";
import { randomInt } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { db } from "../../../models/db.js";
import { mailInsertQueue } from "../../../queues/mail-campaign.queue.js";
import { billMailCampaign } from "../../billing/services/MailBillingService.js";

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
import type { MailRecipientRow } from "../../../queues/mail-campaign.queue.js";

// ── constants ──────────────────────────────────────────────────
const CHUNK_SIZE   = 500;
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

// ── helpers ────────────────────────────────────────────────────

function generateCampaignId(): string {
  return `mail-${Date.now()}${randomInt(1000, 9999)}`;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Remove 4-byte UTF-8 characters (emojis) to prevent MySQL encoding errors
function sanitizeForMysql(text: string): string {
  // Remove emojis and other 4-byte UTF-8 characters
  return text.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
}

/** Lightweight CSV parser — handles quoted fields, \r\n / \n */
function parseCSV(buffer: Buffer): string[][] {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  
  // For large CSVs, process in smaller batches to avoid blocking
  if (lines.length > 10000) {
    console.log(`Processing large CSV with ${lines.length} lines`);
  }
  
  return lines.map(line => {
    const cols: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cols.push(cur.trim()); cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  });
}

/** Email regex — basic guard */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Build recipient rows from CSV.
 *
 * Expected CSV format (first row = header):
 *   email, name, company, promo, ...
 *
 * Column 0 must be "email" (or any name — position 0 is always the email).
 * Remaining columns become variable names:
 *   {{name}}, {{company}}, {{promo}}, etc.
 */
function buildRowsFromCSV(rows: string[][]): MailRecipientRow[] {
  if (rows.length < 2) return [];

  // Header row → variable name mapping
  const headers = rows[0].map(h => h.toLowerCase().trim());

  const result: MailRecipientRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols  = rows[i];
    const email = cols[0]?.trim().toLowerCase();
    if (!email || !isValidEmail(email)) continue;

    const recipientName = cols[1]?.trim() || null;   // column 1 = name (convention)

    const customVars: Record<string, string> = {};
    for (let j = 1; j < headers.length; j++) {
      if (cols[j]?.trim()) customVars[headers[j]] = cols[j].trim();
    }

    result.push({ email, recipientName, customVars });
  }

  return result;
}

/** Build rows from plain-text email list (one per line) — no variables */
function buildRowsFromText(text: string): MailRecipientRow[] {
  return text
    .split(/[\n,;]+/)
    .map(e => e.trim().toLowerCase())
    .filter(e => isValidEmail(e))
    .map(email => ({ email, recipientName: null, customVars: {} }));
}

async function saveAttachment(
  buffer: Buffer,
  originalName: string,
): Promise<{ path: string; name: string }> {
  const dir = path.join(UPLOADS_ROOT, "mail", "attachments");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const ext      = path.extname(originalName) || "";
  const safeName = `${Date.now()}_${randomInt(10000, 99999)}${ext}`;
  await writeFile(path.join(dir, safeName), buffer);
  return { path: `/uploads/mail/attachments/${safeName}`, name: originalName };
}

// ============================================================
// POST /api/users/auth/mail/campaign/submit
// ============================================================
export const submitMailCampaign = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const accountUsername = await resolveAccountUsername(req);
  if (!accountUsername) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }
  const username = accountUsername;

  // ── 1. Parse multipart ────────────────────────────────────
  const fields: Record<string, string>  = {};
  const files: Record<string, { buffer: Buffer; filename: string; mimetype: string }> = {};

  try {
    for await (const part of (req as any).parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        files[part.fieldname] = { buffer: buf, filename: part.filename ?? "file", mimetype: part.mimetype ?? "" };
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }
  } catch {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "Invalid multipart form", data: null });
  }

  // ── 2. Validate required fields ───────────────────────────
  const campaignName   = sanitizeForMysql(fields["campaign_name"]?.trim() || "");
  const subject        = fields["subject"]?.trim();
  const bodyHtml       = fields["body_html"]?.trim();
  const smtpAccountId  = fields["smtp_account_id"]?.trim();

  if (!campaignName)  return reply.status(400).send({ status: 0, statuscode: 400, message: "campaign_name is required", data: null });
  if (!subject)       return reply.status(400).send({ status: 0, statuscode: 400, message: "subject is required", data: null });
  if (!bodyHtml)      return reply.status(400).send({ status: 0, statuscode: 400, message: "body_html is required", data: null });
  if (!smtpAccountId) return reply.status(400).send({ status: 0, statuscode: 400, message: "smtp_account_id is required", data: null });

  // ── 3. Optional fields ────────────────────────────────────
  const bodyText = fields["body_text"]?.trim() || null;

  // ── 4. Verify SMTP account belongs to user ────────────────
  const smtpAccount: any = await (db as any)
    .selectFrom("mail_smtp_accounts")
    .select(["id", "from_name", "from_email", "status"])
    .where("id",       "=", Number(smtpAccountId))
    .where("username", "=", username)
    .executeTakeFirst();

  if (!smtpAccount) {
    return reply.status(404).send({ status: 0, statuscode: 404, message: "SMTP account not found", data: null });
  }
  if (smtpAccount.status !== "active") {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "SMTP account is inactive", data: null });
  }

  // ── 5. Build recipient rows ───────────────────────────────
  let rows: MailRecipientRow[] = [];

  if (files["csv_file"]?.buffer.length) {
    const csvData = parseCSV(files["csv_file"].buffer);
    rows = buildRowsFromCSV(csvData);
  } else if (fields["emails_text"]?.trim()) {
    rows = buildRowsFromText(fields["emails_text"]);
  }

  if (rows.length === 0) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "No valid email addresses found. Provide csv_file or emails_text.", data: null });
  }

  // ── 6. Handle optional attachment ────────────────────────
  let attachmentPath: string | null = null;
  let attachmentName: string | null = null;

  if (files["attachment"]?.buffer.length) {
    const saved    = await saveAttachment(files["attachment"].buffer, files["attachment"].filename);
    attachmentPath = saved.path;
    attachmentName = saved.name;
  }

  // ── 6.5 Billing ──────────────────────────────────────────
  const campaignId = generateCampaignId();

  const billing = await billMailCampaign(campaignId, username, rows.length);
  if (!billing.ok) {
    return reply.status(402).send({
      status:     0,
      statuscode: 402,
      message:    `Insufficient balance. Wallet has ₹${(billing as any).balance.toFixed(2)}, rate is ₹${(billing as any).rate} per email.`,
      data:       null,
    });
  }
  if (!billing.skip && (billing as any).leftover > 0) {
    rows = rows.slice(0, (billing as any).affordable);
  }

  // ── 7. Insert campaign summary ────────────────────────────
  const now = new Date();

  await (db as any)
    .insertInto("mail_camp_summary")
    .values({
      campaign_id:     campaignId,
      username,
      campaign_name:   campaignName,
      subject,
      from_name:       smtpAccount.from_name,
      from_email:      smtpAccount.from_email,
      smtp_account_id: Number(smtpAccountId),
      body_html:       bodyHtml,
      body_text:       bodyText,
      attachment_path: attachmentPath,
      attachment_name: attachmentName,
      total:           rows.length,
      sent_count:      0,
      failed_count:    0,
      status:          "pending",
      created_at:      now,
      updated_at:      now,
    })
    .execute();

  // ── 8. Queue insert-jobs (one per CHUNK_SIZE rows) ────────
  const chunks      = chunkArray(rows, CHUNK_SIZE);
  const totalChunks = chunks.length;

  try {
    // Queue all chunks in parallel for better performance
    const queuePromises = chunks.map((chunk, i) => 
      (mailInsertQueue as any).add(
        `insert-${campaignId}-chunk-${i}`,
        {
          campaignId,
          username,
          chunkIndex:  i,
          totalChunks,
          rows:        chunk,
        },
        { priority: 1 }
      )
    );

    // Wait for all jobs to be queued successfully
    await Promise.all(queuePromises);
    console.log(`[mailCampaign] Successfully queued ${totalChunks} chunks for campaign ${campaignId}`);

  } catch (error: any) {
    console.error(`[mailCampaign] Failed to queue chunks for campaign ${campaignId}:`, error.message);
    
    // Rollback: delete the campaign summary since we couldn't queue the jobs
    await (db as any)
      .deleteFrom("mail_camp_summary")
      .where("campaign_id", "=", campaignId)
      .execute()
      .catch(() => {});
    
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to queue campaign jobs. Please check if Redis is running and try again.",
      data: null,
    });
  }

  // ── 9. Return 202 immediately ─────────────────────────────
  return reply.status(202).send({
    status:     1,
    statuscode: 202,
    message:    "Mail campaign submitted.",
    data: {
      campaign_id:   campaignId,
      campaign_name: campaignName,
      subject,
      from_email:    smtpAccount.from_email,
      total:         rows.length,
      chunks:        totalChunks,
      has_attachment: !!attachmentPath,
    },
  });
};
// ============================================================
// GET /api/users/auth/mail/campaigns
// List all campaigns for the logged-in user
// ============================================================
export const listMailCampaigns = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string; status?: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  const page = parseInt(req.query.page || "1");
  const limit = parseInt(req.query.limit || "20");
  const status = req.query.status;
  const offset = (page - 1) * limit;

  try {
    let query = (db as any)
      .selectFrom("mail_camp_summary")
      .select([
        "campaign_id",
        "campaign_name", 
        "subject",
        "from_name",
        "from_email",
        "smtp_account_id",
        "total",
        "sent_count",
        "failed_count",
        "status",
        "created_at",
        "updated_at"
      ])
      .where("username", "=", username)
      .orderBy("created_at", "desc");

    // Filter by status if provided
    if (status && status !== "all") {
      query = query.where("status", "=", status);
    }

    // Get total count for pagination
    const totalQuery = (db as any)
      .selectFrom("mail_camp_summary")
      .select((eb: any) => eb.fn.count("campaign_id").as("count"))
      .where("username", "=", username);

    if (status && status !== "all") {
      totalQuery.where("status", "=", status);
    }

    const [campaigns, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).execute(),
      totalQuery.executeTakeFirst()
    ]);

    const total = Number(totalResult?.count || 0);
    const totalPages = Math.ceil(total / limit);

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "Campaigns fetched successfully",
      data: campaigns,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    });
  } catch (error) {
    console.error("Failed to fetch campaigns:", error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch campaigns",
      data: null,
    });
  }
};

// ============================================================
// GET /api/users/auth/mail/campaigns/:campaignId
// Get campaign details including recipient statistics
// ============================================================
export const getCampaignDetails = async (
  req: FastifyRequest<{ Params: { campaignId: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  const { campaignId } = req.params;

  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  try {
    // Get campaign summary
    const campaign: any = await (db as any)
      .selectFrom("mail_camp_summary")
      .selectAll()
      .where("campaign_id", "=", campaignId)
      .where("username", "=", username)
      .executeTakeFirst();

    if (!campaign) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Campaign not found",
        data: null,
      });
    }

    // Get recipient statistics
    const recipientStats: any = await (db as any)
      .selectFrom("mail_camp_details")
      .select([
        "status",
        (eb: any) => eb.fn.count("id").as("count")
      ])
      .where("campaign_id", "=", campaignId)
      .where("username", "=", username)
      .groupBy("status")
      .execute();

    // Transform stats into a more usable format
    const stats = recipientStats.reduce((acc: any, stat: any) => {
      acc[stat.status] = Number(stat.count);
      return acc;
    }, {});

    // Get recent recipient details (last 50)
    const recentRecipients: any = await (db as any)
      .selectFrom("mail_camp_details")
      .select([
        "email",
        "recipient_name",
        "status",
        "sent_at",
        "error_message",
        "created_at"
      ])
      .where("campaign_id", "=", campaignId)
      .where("username", "=", username)
      .orderBy("created_at", "desc")
      .limit(50)
      .execute();

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "Campaign details fetched successfully",
      data: {
        campaign,
        recipient_stats: {
          total: campaign.total,
          sent: campaign.sent_count,
          failed: campaign.failed_count,
          pending: stats.pp1 || 0,
          sending: stats.sending || 0,
          delivered: stats.sent || 0,
          bounced: stats.failed || 0,
        },
        recent_recipients: recentRecipients,
      },
    });
  } catch (error) {
    console.error("Failed to fetch campaign details:", error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch campaign details",
      data: null,
    });
  }
};

// ============================================================
// DELETE /api/users/auth/mail/campaigns/:campaignId
// Delete a campaign (only if not sending/completed)
// ============================================================
export const deleteCampaign = async (
  req: FastifyRequest<{ Params: { campaignId: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  const { campaignId } = req.params;

  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  try {
    // Check if campaign exists and belongs to user
    const campaign: any = await (db as any)
      .selectFrom("mail_camp_summary")
      .select(["campaign_id", "status"])
      .where("campaign_id", "=", campaignId)
      .where("username", "=", username)
      .executeTakeFirst();

    if (!campaign) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Campaign not found",
        data: null,
      });
    }

    // Don't allow deletion of active campaigns
    if (campaign.status === "sending" || campaign.status === "completed") {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Cannot delete active or completed campaigns",
        data: null,
      });
    }

    // Delete campaign details first (foreign key constraint)
    await (db as any)
      .deleteFrom("mail_camp_details")
      .where("campaign_id", "=", campaignId)
      .execute();

    // Delete campaign summary
    await (db as any)
      .deleteFrom("mail_camp_summary")
      .where("campaign_id", "=", campaignId)
      .execute();

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "Campaign deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Failed to delete campaign:", error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to delete campaign",
      data: null,
    });
  }
};

// ============================================================
// GET /api/users/auth/mail/analytics
// Get email campaign analytics and performance metrics
// ============================================================
export const getMailAnalytics = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  try {
    // Get all campaigns for the user
    const campaigns: any[] = await (db as any)
      .selectFrom("mail_camp_summary")
      .select([
        "campaign_id",
        "campaign_name",
        "total",
        "sent_count",
        "failed_count",
        "status",
        "created_at",
        "updated_at"
      ])
      .where("username", "=", username)
      .execute();

    // Get SMTP accounts count
    const smtpAccounts: any[] = await (db as any)
      .selectFrom("mail_smtp_accounts")
      .select(["id", "status"])
      .where("username", "=", username)
      .execute();

    // Get email templates count
    const templates: any[] = await (db as any)
      .selectFrom("mail_templates")
      .select(["id", "status"])
      .where("username", "=", username)
      .execute();

    // Calculate metrics
    const totalCampaigns = campaigns.length;
    const activeAccounts = smtpAccounts.filter(a => a.status === "active").length;
    const totalTemplates = templates.length;
    
    const totalEmailsSent = campaigns.reduce((sum, c) => sum + (Number(c.sent_count) || 0), 0);
    const totalEmailsAttempted = campaigns.reduce((sum, c) => sum + (Number(c.total) || 0), 0);
    const totalFailed = campaigns.reduce((sum, c) => sum + (Number(c.failed_count) || 0), 0);
    
    // Calculate rates
    const deliveryRate = totalEmailsAttempted > 0 
      ? ((totalEmailsSent / totalEmailsAttempted) * 100).toFixed(1)
      : "0.0";
    
    const successRate = totalEmailsAttempted > 0
      ? (((totalEmailsSent - totalFailed) / totalEmailsAttempted) * 100).toFixed(1)
      : "0.0";

    // Campaign status breakdown
    const statusBreakdown = {
      completed: campaigns.filter(c => c.status === "completed").length,
      sending: campaigns.filter(c => c.status === "sending").length,
      pending: campaigns.filter(c => c.status === "pending").length,
      failed: campaigns.filter(c => c.status === "failed").length,
    };

    // Get recent campaigns (last 10)
    const recentCampaigns = campaigns
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
      .map(c => ({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        status: c.status,
        total: c.total,
        sent_count: c.sent_count,
        failed_count: c.failed_count,
        success_rate: c.total > 0 ? (((c.sent_count - c.failed_count) / c.total) * 100).toFixed(1) : "0.0",
        updated_at: c.updated_at,
      }));

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "Analytics fetched successfully",
      data: {
        overview: {
          total_campaigns: totalCampaigns,
          active_accounts: activeAccounts,
          total_templates: totalTemplates,
          total_emails_sent: totalEmailsSent,
          total_emails_attempted: totalEmailsAttempted,
          total_failed: totalFailed,
          delivery_rate: deliveryRate,
          success_rate: successRate,
        },
        status_breakdown: statusBreakdown,
        recent_campaigns: recentCampaigns,
      },
    });
  } catch (error) {
    console.error("Failed to fetch analytics:", error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch analytics",
      data: null,
    });
  }
};

// ============================================================
// PUT /api/users/auth/mail/campaigns/:campaignId/pause
// Pause a running campaign
// ============================================================
export const pauseCampaign = async (
  req: FastifyRequest<{ Params: { campaignId: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  const { campaignId } = req.params;

  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  try {
    const result = await (db as any)
      .updateTable("mail_camp_summary")
      .set({
        status: "paused",
        updated_at: new Date(),
      })
      .where("campaign_id", "=", campaignId)
      .where("username", "=", username)
      .where("status", "=", "sending")
      .executeTakeFirst();

    if (result.numUpdatedRows === 0) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Campaign not found or not in sending state",
        data: null,
      });
    }

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "Campaign paused successfully",
      data: { campaign_id: campaignId },
    });
  } catch (error) {
    console.error("Failed to pause campaign:", error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to pause campaign",
      data: null,
    });
  }
};

// ============================================================
// PUT /api/users/auth/mail/campaigns/:campaignId/resume
// Resume a paused campaign
// ============================================================
export const resumeCampaign = async (
  req: FastifyRequest<{ Params: { campaignId: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveAccountUsername(req);
  const { campaignId } = req.params;

  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  try {
    const result = await (db as any)
      .updateTable("mail_camp_summary")
      .set({
        status: "sending",
        updated_at: new Date(),
      })
      .where("campaign_id", "=", campaignId)
      .where("username", "=", username)
      .where("status", "=", "paused")
      .executeTakeFirst();

    if (result.numUpdatedRows === 0) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Campaign not found or not in paused state",
        data: null,
      });
    }

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "Campaign resumed successfully",
      data: { campaign_id: campaignId },
    });
  } catch (error) {
    console.error("Failed to resume campaign:", error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to resume campaign",
      data: null,
    });
  }
};