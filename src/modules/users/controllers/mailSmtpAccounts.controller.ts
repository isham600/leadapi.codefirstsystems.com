import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

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

// ── Types ──────────────────────────────────────────────────────

interface SmtpBody {
  account_name: string;
  smtp_host:    string;
  smtp_port:    number;
  smtp_user:    string;
  smtp_password: string;
  from_name:    string;
  from_email:   string;
  encryption:   "none" | "tls" | "ssl";
}

// ============================================================
// GET /api/users/auth/mail/smtp-accounts
// List all SMTP accounts for the logged-in user
// ============================================================
export const listSmtpAccounts = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const accountUsername = await resolveAccountUsername(req);
  if (!accountUsername) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  const accounts = await (db as any)
    .selectFrom("mail_smtp_accounts")
    .select(["id", "account_name", "smtp_host", "smtp_port", "smtp_user", "from_name", "from_email", "encryption", "status", "created_at"])
    .where("username", "=", accountUsername)
    .orderBy("created_at", "desc")
    .execute();

  return reply.send({ status: 1, statuscode: 200, message: "SMTP accounts fetched", data: accounts });
};

// ============================================================
// POST /api/users/auth/mail/smtp-accounts
// Add a new SMTP account
// ============================================================
export const addSmtpAccount = async (
  req: FastifyRequest<{ Body: SmtpBody }>,
  reply: FastifyReply,
) => {
  const accountUsername = await resolveAccountUsername(req);
  if (!accountUsername) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  const { account_name, smtp_host, smtp_port, smtp_user, smtp_password, from_name, from_email, encryption } = req.body ?? {};

  if (!account_name || !smtp_host || !smtp_port || !smtp_user || !smtp_password || !from_name || !from_email) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "account_name, smtp_host, smtp_port, smtp_user, smtp_password, from_name, from_email are required", data: null });
  }

  const now = new Date();

  const result: any = await (db as any)
    .insertInto("mail_smtp_accounts")
    .values({
      username: accountUsername,
      account_name:  account_name.trim(),
      smtp_host:     smtp_host.trim(),
      smtp_port:     Number(smtp_port),
      smtp_user:     smtp_user.trim(),
      smtp_password: smtp_password.trim(),
      from_name:     from_name.trim(),
      from_email:    from_email.trim().toLowerCase(),
      encryption:    encryption ?? "tls",
      status:        "active",
      created_at:    now,
      updated_at:    now,
    })
    .executeTakeFirst();

  return reply.status(201).send({
    status: 1, statuscode: 201, message: "SMTP account added",
    data: { id: Number(result?.insertId ?? 0) },
  });
};

// ============================================================
// PUT /api/users/auth/mail/smtp-accounts/:id
// Update an SMTP account
// ============================================================
export const updateSmtpAccount = async (
  req: FastifyRequest<{ Params: { id: string }; Body: Partial<SmtpBody> }>,
  reply: FastifyReply,
) => {
  const accountUsername = await resolveAccountUsername(req);
  if (!accountUsername) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  const id = Number(req.params.id);
  const { account_name, smtp_host, smtp_port, smtp_user, smtp_password, from_name, from_email, encryption } = req.body ?? {};

  const updates: Record<string, any> = { updated_at: new Date() };
  if (account_name)  updates.account_name  = account_name.trim();
  if (smtp_host)     updates.smtp_host     = smtp_host.trim();
  if (smtp_port)     updates.smtp_port     = Number(smtp_port);
  if (smtp_user)     updates.smtp_user     = smtp_user.trim();
  if (smtp_password) updates.smtp_password = smtp_password.trim();
  if (from_name)     updates.from_name     = from_name.trim();
  if (from_email)    updates.from_email    = from_email.trim().toLowerCase();
  if (encryption)    updates.encryption    = encryption;

  await (db as any)
    .updateTable("mail_smtp_accounts")
    .set(updates)
    .where("id", "=", id)
    .where("username", "=", accountUsername)
    .execute();

  return reply.send({ status: 1, statuscode: 200, message: "SMTP account updated", data: null });
};

// ============================================================
// DELETE /api/users/auth/mail/smtp-accounts/:id
// Delete an SMTP account
// ============================================================
export const deleteSmtpAccount = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const accountUsername = await resolveAccountUsername(req);
  if (!accountUsername) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  const id = Number(req.params.id);

  await (db as any)
    .deleteFrom("mail_smtp_accounts")
    .where("id", "=", id)
    .where("username", "=", accountUsername)
    .execute();

  return reply.send({ status: 1, statuscode: 200, message: "SMTP account deleted", data: null });
};

// ============================================================
// POST /api/users/auth/mail/smtp-accounts/:id/test
// Test SMTP connection (sends a test email to from_email)
// ============================================================
export const testSmtpAccount = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const accountUsername = await resolveAccountUsername(req);
  if (!accountUsername) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });

  const id = Number(req.params.id);

  const account: any = await (db as any)
    .selectFrom("mail_smtp_accounts")
    .selectAll()
    .where("id", "=", id)
    .where("username", "=", accountUsername)
    .executeTakeFirst();

  if (!account) return reply.status(404).send({ status: 0, statuscode: 404, message: "SMTP account not found", data: null });

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host:   account.smtp_host,
      port:   Number(account.smtp_port),
      secure: account.encryption === "ssl",
      auth:   { user: account.smtp_user, pass: account.smtp_password },
      tls:    account.encryption === "none" ? { rejectUnauthorized: false } : undefined,
    });

    await transporter.sendMail({
      from:    `"${account.from_name}" <${account.from_email}>`,
      to:      account.from_email,
      subject: "SMTP Test — Indew Lead",
      text:    "This is a test email to confirm your SMTP configuration is working correctly.",
    });

    return reply.send({ status: 1, statuscode: 200, message: "Test email sent successfully", data: null });
  } catch (err: any) {
    return reply.status(400).send({
      status: 0, statuscode: 400,
      message: `SMTP test failed: ${err?.message ?? "Unknown error"}`,
      data: null,
    });
  }
};
