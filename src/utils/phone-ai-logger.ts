/**
 * AI Call Logger
 * Writes structured event records to `phone_ai_call_logs` table AND to stdout.
 * All DB errors are silently swallowed — logging must never break a live call.
 */

import { db } from "../models/db.js";

export type CallEventType =
  | "call_start"
  | "tts_ok"
  | "ami_sent"
  | "ami_result"
  | "stt"
  | "gpt"
  | "tts_response"
  | "dtmf_press"
  | "call_result"
  | "error";

export interface LogCtx {
  requestId?:   string;
  username?:    string;
  phoneNumber?: string;
  callMode?:    string;
  turn?:        number;
}

/**
 * Log a single call event.
 * Always fire-and-forget — await is optional (caller's choice).
 */
export async function aiCallLog(
  detailId: number,
  event:    CallEventType | string,
  payload:  Record<string, any>,
  ctx:      LogCtx = {}
): Promise<void> {
  // ── stdout (always) ───────────────────────────────────────────
  console.log(
    `[ai-call-log] ${new Date().toISOString()} detail=${detailId} event=${event}` +
    (ctx.turn != null ? ` turn=${ctx.turn}` : "") +
    " " + JSON.stringify(payload)
  );

  // ── DB (non-blocking) ─────────────────────────────────────────
  try {
    await (db as any)
      .insertInto("phone_ai_call_logs")
      .values({
        detail_id:    detailId,
        request_id:   ctx.requestId   ?? "",
        username:     ctx.username    ?? "",
        phone_number: ctx.phoneNumber ?? "",
        call_mode:    ctx.callMode    ?? "",
        event,
        turn:         ctx.turn        ?? null,
        payload:      JSON.stringify(payload),
        created_at:   new Date(),
      })
      .execute();
  } catch {
    // Never throw — a log failure must not kill a live call
  }
}

/**
 * Fetch all log rows for a single call detail row, ordered by time.
 */
export async function getCallLogs(detailId: number): Promise<any[]> {
  return (db as any)
    .selectFrom("phone_ai_call_logs")
    .selectAll()
    .where("detail_id", "=", detailId)
    .orderBy("created_at", "asc")
    .execute();
}
