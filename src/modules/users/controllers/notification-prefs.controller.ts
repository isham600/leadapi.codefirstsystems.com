import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

const DEFAULT_PREFS = {
  email_new_lead:       1,
  email_daily_digest:   0,
  email_weekly_report:  1,
  email_status_change:  1,
  inapp_new_lead:       1,
  inapp_status_change:  1,
  inapp_new_message:    1,
  inapp_followup_due:   1,
  inapp_overdue:        1,
  inapp_pipeline:       1,
  inapp_automation_fail:1,
  push_urgent:          0,
};

export async function getNotificationPrefs(req: FastifyRequest, reply: FastifyReply) {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const row = await (db as any)
    .selectFrom("notification_prefs")
    .selectAll()
    .where("username", "=", username)
    .executeTakeFirst();

  // Return defaults if no row yet
  const prefs = row ?? { username, ...DEFAULT_PREFS };

  return reply.send({
    status: 1,
    data: {
      email_new_lead:       (prefs.email_new_lead       ?? 1) === 1,
      email_daily_digest:   (prefs.email_daily_digest   ?? 0) === 1,
      email_weekly_report:  (prefs.email_weekly_report  ?? 1) === 1,
      email_status_change:  (prefs.email_status_change  ?? 1) === 1,
      inapp_new_lead:       (prefs.inapp_new_lead       ?? 1) === 1,
      inapp_status_change:  (prefs.inapp_status_change  ?? 1) === 1,
      inapp_new_message:    (prefs.inapp_new_message    ?? 1) === 1,
      inapp_followup_due:   (prefs.inapp_followup_due   ?? 1) === 1,
      inapp_overdue:        (prefs.inapp_overdue        ?? 1) === 1,
      inapp_pipeline:       (prefs.inapp_pipeline       ?? 1) === 1,
      inapp_automation_fail:(prefs.inapp_automation_fail?? 1) === 1,
      push_urgent:          (prefs.push_urgent          ?? 0) === 1,
    },
  });
}

export async function updateNotificationPrefs(req: FastifyRequest, reply: FastifyReply) {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

  const body = req.body as Record<string, boolean>;

  const values: Record<string, number> = {};
  const allowed = Object.keys(DEFAULT_PREFS);
  for (const key of allowed) {
    if (key in body) values[key] = body[key] ? 1 : 0;
  }

  if (Object.keys(values).length === 0)
    return reply.code(400).send({ status: 0, message: "No valid fields provided" });

  // Upsert
  const existing = await (db as any)
    .selectFrom("notification_prefs")
    .select(["id"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (existing) {
    await (db as any)
      .updateTable("notification_prefs")
      .set({ ...values, updated_at: new Date() })
      .where("username", "=", username)
      .execute();
  } else {
    await (db as any)
      .insertInto("notification_prefs")
      .values({ username, ...DEFAULT_PREFS, ...values, created_at: new Date(), updated_at: new Date() })
      .execute();
  }

  return reply.send({ status: 1, message: "Preferences saved" });
}
