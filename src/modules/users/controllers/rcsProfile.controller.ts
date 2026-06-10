import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

async function resolveAccountUsername(req: FastifyRequest): Promise<string | null> {
  const username = (req as any).user?.username ?? null;
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

// GET /rcsProfile
// Returns the active RCS account profile + stats derived from chat_messages
export const getRcsProfile = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = await resolveAccountUsername(req);
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const account = await (db as any)
    .selectFrom("rcs_accounts")
    .selectAll()
    .where("username", "=", username)
    .where("status", "=", "active")
    .orderBy("created_at", "desc")
    .executeTakeFirst();

  if (!account) {
    return reply.send({ status: 0, message: "No active RCS account found.", data: null });
  }

  // Compute stats from chat_messages for this agent
  const [totalMsgs, inboundMsgs, campaignCount] = await Promise.all([
    (db as any)
      .selectFrom("chat_messages")
      .select((eb: any) => eb.fn.count("id").as("cnt"))
      .where("username", "=", username)
      .where("channel", "=", "rcs")
      .executeTakeFirst(),
    (db as any)
      .selectFrom("chat_messages")
      .select((eb: any) => eb.fn.count("id").as("cnt"))
      .where("username", "=", username)
      .where("channel", "=", "rcs")
      .where("direction", "=", "inbound")
      .executeTakeFirst(),
    (db as any)
      .selectFrom("rcs_camp_summary")
      .select((eb: any) => eb.fn.count("id").as("cnt"))
      .where("username", "=", username)
      .executeTakeFirst()
      .catch(() => ({ cnt: 0 })),
  ]);

  const total   = Number(totalMsgs?.cnt  ?? 0);
  const inbound = Number(inboundMsgs?.cnt ?? 0);

  return reply.send({
    status: 1,
    data: {
      agent: {
        agent_id:    account.agent_id,
        bot_id:      account.bot_id   ?? null,
        bot_name:    account.bot_name ?? null,
        status:      account.status,
        created_at:  account.created_at,
      },
      stats: {
        total_messages: total,
        delivered:      total,            // RCS has no delivery receipts in our DB yet
        read:           inbound,          // inbound = replies/reads
        replied:        inbound,
        campaigns:      Number(campaignCount?.cnt ?? 0),
      },
    },
  });
};
