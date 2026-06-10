import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

export const getIntegrationStatus = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const username = req.user?.username;
  const userType = (req.user as any)?.user_type as number | undefined;

  if (!username) {
    return reply.status(401).send({
      status: 0,
      statuscode: 401,
      message: "Unauthorized",
      data: null,
    });
  }

  // ── Agent hierarchy: agents use their parent's integrations ──
  let accountUsername = username;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    accountUsername = parentRow?.parent_username ?? username;
  }

  // Check all integrations in parallel
  const [whatsapp, user, smppGateway, smtpAccounts, rcsAccount, metaAccount, phoneIvr] = await Promise.all([
    db
      .selectFrom("whatsapp_accounts")
      .select(["status"])
      .where("username", "=", accountUsername)
      .executeTakeFirst(),
    (db as any)
      .selectFrom("users")
      .select(["google_access_token"])
      .where("username", "=", accountUsername)
      .executeTakeFirst(),
    (db as any)
      .selectFrom("smpp_gateways")
      .select(["status", "connection_state"])
      .where("username", "=", accountUsername)
      .executeTakeFirst(),
    (db as any)
      .selectFrom("mail_smtp_accounts")
      .select(["status"])
      .where("username", "=", accountUsername)
      .where("status", "=", "active")
      .executeTakeFirst(),
    (db as any)
      .selectFrom("rcs_accounts")
      .select(["status"])
      .where("username", "=", accountUsername)
      .where("status", "=", "active")
      .executeTakeFirst(),
    (db as any)
      .selectFrom("meta_accounts")
      .select(["status"])
      .where("username", "=", accountUsername)
      .where("status",   "=", "active")
      .executeTakeFirst(),

    (db as any)
      .selectFrom("phone_ivr_accounts")
      .select(["status"])
      .where("username", "=", accountUsername)
      .where("status",   "=", "active")
      .executeTakeFirst(),
  ]);

  const whatsappConnected  = whatsapp?.status === "active" ? "connected" : "disconnected";
  const googleConnected    = user?.google_access_token ? "connected" : "disconnected";
  const smppConnected      = smppGateway?.status === "active" ? "connected" : "disconnected";
  const emailConnected     = smtpAccounts?.status === "active" ? "connected" : "disconnected";
  const rcsConnected       = rcsAccount?.status === "active" ? "connected" : "disconnected";
  const facebookConnected  = metaAccount ? "connected" : "disconnected";
  const phoneConnected     = phoneIvr?.status === "active" ? "connected" : "disconnected";

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Integration status fetched",
    data: {
      whatsapp:     whatsappConnected,
      metaads:      facebookConnected,
      facebook:     facebookConnected,
      linkedin:     "disconnected",
      googleads:    googleConnected,
      email:        emailConnected,
      phone:        phoneConnected,
      smpp_gateway: smppConnected,
      rcs:          rcsConnected,
    },
  });
};
