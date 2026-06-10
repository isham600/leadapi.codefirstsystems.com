import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

export async function getNotifications(req: FastifyRequest, reply: FastifyReply) {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const query = req.query as { page?: string; limit?: string; unread_only?: string };
  const page  = Math.max(1, Number(query.page  ?? 1));
  const limit = Math.min(50, Math.max(1, Number(query.limit ?? 20)));
  const offset = (page - 1) * limit;
  const unreadOnly = query.unread_only === "true";

  let q = (db as any)
    .selectFrom("notifications")
    .selectAll()
    .where("username", "=", username);

  if (unreadOnly) q = q.where("read_at", "is", null);

  const [rows, countRow] = await Promise.all([
    q.orderBy("created_at", "desc").limit(limit).offset(offset).execute(),
    (db as any)
      .selectFrom("notifications")
      .select((eb: any) => [eb.fn.count("id").as("total")])
      .where("username", "=", username)
      .$if(unreadOnly, (qb: any) => qb.where("read_at", "is", null))
      .executeTakeFirst(),
  ]);

  const unreadCount = await (db as any)
    .selectFrom("notifications")
    .select((eb: any) => [eb.fn.count("id").as("count")])
    .where("username", "=", username)
    .where("read_at", "is", null)
    .executeTakeFirst();

  return reply.send({
    status: 1,
    data: {
      list:         rows,
      total:        Number(countRow?.total ?? 0),
      unread_count: Number(unreadCount?.count ?? 0),
      page,
      limit,
    },
  });
}

export async function markRead(req: FastifyRequest, reply: FastifyReply) {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const { id } = req.params as { id: string };

  await (db as any)
    .updateTable("notifications")
    .set({ read_at: new Date() })
    .where("id", "=", Number(id))
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "Marked as read" });
}

export async function markAllRead(req: FastifyRequest, reply: FastifyReply) {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .updateTable("notifications")
    .set({ read_at: new Date() })
    .where("username", "=", username)
    .where("read_at", "is", null)
    .execute();

  return reply.send({ status: 1, message: "All marked as read" });
}

export async function clearNotifications(req: FastifyRequest, reply: FastifyReply) {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .deleteFrom("notifications")
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, message: "Cleared" });
}
