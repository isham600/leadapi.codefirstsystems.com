import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { whatsappTemplateSyncQueue } from "../../../queues/whatsapp-template-sync.queue.js";

// ============================================================
// POST /api/users/syncWhatsappTemplates
// Returns 202 immediately, queues one BullMQ job per account
// ============================================================
export const syncWhatsappTemplates = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const username = req.user?.username;

  if (!username) {
    return reply.status(401).send({
      status: 0,
      statuscode: 401,
      message: "Unauthorized",
      data: null,
    });
  }

  // ── Agent hierarchy ───────────────────────────────────────
  const userType = (req as any).user?.user_type as number | undefined;
  let accountUsername = username;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    accountUsername = parentRow?.parent_username ?? username;
  }

  // Get all active whatsapp accounts for this user
  const accounts: any[] = await (db as any)
    .selectFrom("whatsapp_accounts")
    .select(["id", "waba_id", "access_token"])
    .where("username", "=", accountUsername)
    .where("status", "=", "active")
    .execute();

  if (accounts.length === 0) {
    return reply.status(200).send({
      status: 0,
      statuscode: 200,
      message: "No active WhatsApp accounts found",
      data: null,
    });
  }

  // Queue one job per account
  await Promise.all(
    accounts.map((account) =>
      whatsappTemplateSyncQueue.add(
        `sync-templates-${accountUsername}-${account.id}-${Date.now()}` as any,
        {
          username: accountUsername,
          accountId: account.id,
          wabaId:    String(account.waba_id),
          accessToken: account.access_token,
        },
        { priority: 1 }
      )
    )
  );

  return reply.status(202).send({
    status: 1,
    statuscode: 202,
    message: `Template sync queued for ${accounts.length} account(s)`,
    data: { accounts: accounts.length },
  });
};
