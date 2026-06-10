import { db } from "../models/db.js";
import { publishInboxEvent } from "./ws-publisher.js";

export type NotifyType =
  | "new_lead"
  | "assigned"
  | "status_change"
  | "new_message"
  | "followup_due"
  | "overdue"
  | "automation_fail";

export interface NotifyPayload {
  username: string;   // recipient username
  uuid?: string;      // recipient uuid for WS push (optional)
  type: NotifyType;
  title: string;
  description?: string;
  link?: string;
}

/**
 * Checks if the user has in-app notifications enabled for the given type.
 */
async function isInappEnabled(username: string, type: NotifyType): Promise<boolean> {
  const prefs = await (db as any)
    .selectFrom("notification_prefs")
    .select([
      "inapp_new_lead", "inapp_status_change", "inapp_new_message",
      "inapp_followup_due", "inapp_overdue", "inapp_pipeline", "inapp_automation_fail",
    ])
    .where("username", "=", username)
    .executeTakeFirst();

  if (!prefs) return true; // default: all enabled

  const map: Record<NotifyType, string> = {
    new_lead:       "inapp_new_lead",
    assigned:       "inapp_new_lead",
    status_change:  "inapp_status_change",
    new_message:    "inapp_new_message",
    followup_due:   "inapp_followup_due",
    overdue:        "inapp_overdue",
    automation_fail:"inapp_automation_fail",
  };

  const col = map[type];
  return col ? (prefs[col] ?? 1) === 1 : true;
}

/**
 * Creates a notification in the DB and pushes it via WebSocket.
 * Respects user preferences — skips if disabled.
 */
export async function notify(payload: NotifyPayload): Promise<void> {
  try {
    const enabled = await isInappEnabled(payload.username, payload.type);
    if (!enabled) return;

    // Insert into notifications table
    const result = await (db as any)
      .insertInto("notifications")
      .values({
        username:    payload.username,
        type:        payload.type,
        title:       payload.title,
        description: payload.description ?? null,
        link:        payload.link ?? null,
        read_at:     null,
        created_at:  new Date(),
      })
      .executeTakeFirst();

    const insertId = Number((result as any)?.insertId ?? 0);

    // Push via WebSocket if uuid provided
    if (payload.uuid) {
      await publishInboxEvent(payload.uuid, {
        type:        "new_message" as const,
        id:          insertId,
        notif_type:  payload.type,
        title:       payload.title,
        description: payload.description ?? null,
        link:        payload.link ?? null,
        created_at:  new Date().toISOString(),
      });
    }
  } catch (err: any) {
    // Non-fatal — notifications should never break core flows
    console.error("[notify] failed:", err?.message);
  }
}

/**
 * Looks up a user's uuid from username (needed for WS push).
 */
export async function getUuidByUsername(username: string): Promise<string | null> {
  try {
    const row = await (db as any)
      .selectFrom("users")
      .select(["uuid"])
      .where("username", "=", username)
      .executeTakeFirst();
    return row?.uuid ?? null;
  } catch {
    return null;
  }
}
