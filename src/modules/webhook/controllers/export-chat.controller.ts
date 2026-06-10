import type { FastifyRequest, FastifyReply } from "fastify";
import { stringify } from "csv-stringify";
import { db } from "../../../models/db.js";

// ── IST helper (reuse same pattern as inbox.controller) ──
const IST_OFFSET = 5.5 * 60 * 60 * 1000;

function toIST(val: Date | string | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + IST_OFFSET)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "+05:30");
}

// ── Format cell value for CSV ─────────────────────────────
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

// ── CSV columns definition ────────────────────────────────
const CSV_COLUMNS = [
  { key: "id",               label: "ID" },
  { key: "created_at_ist",   label: "Time (IST)" },
  { key: "direction",        label: "Direction" },
  { key: "type",             label: "Type" },
  { key: "sender_id",        label: "Sender" },
  { key: "receiver_id",      label: "Receiver" },
  { key: "contact_name",     label: "Contact Name" },
  { key: "text",             label: "Message" },
  { key: "media_url",        label: "Media URL" },
  { key: "media_filename",   label: "Media Filename" },
  { key: "reaction_emoji",   label: "Reaction" },
  { key: "location_lat",     label: "Latitude" },
  { key: "location_lng",     label: "Longitude" },
  { key: "location_name",    label: "Location Name" },
  { key: "template_name",    label: "Template Name" },
  { key: "status",           label: "Status" },
  { key: "message_id",       label: "Message ID" },
];

// ============================================================
// GET /api/webhook/auth/inbox/:conversationId/export
// Query: format=csv|json  (default: csv)
//        page, limit (only for json pagination; csv exports ALL)
// ============================================================
export const exportChat = async (
  req: FastifyRequest<{
    Params:      { conversationId: string };
    Querystring: { format?: string; page?: string; limit?: string };
  }>,
  reply: FastifyReply,
) => {
  const username       = req.user?.username;
  const { conversationId } = req.params;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const format = (req.query.format ?? "csv").toLowerCase();
  if (!["csv", "json"].includes(format))
    return reply.status(400).send({ status: 0, message: "format must be csv or json" });

  try {
    // ── Verify conversation belongs to user ───────────────
    const conv: any = await (db as any)
      .selectFrom("chat_message_summary")
      .select(["conversation_id", "channel", "receiver_id", "contact_name", "sender_id"])
      .where("conversation_id", "=", conversationId)
      .where("username",        "=", username)
      .executeTakeFirst();

    if (!conv) return reply.status(404).send({ status: 0, message: "Conversation not found" });

    // ── Fetch all messages (no pagination for export) ─────
    const messages: any[] = await (db as any)
      .selectFrom("chat_messages")
      .select([
        "id", "message_id", "direction", "type",
        "sender_id", "receiver_id", "contact_name",
        "text", "media_url", "media_filename",
        "reaction_emoji",
        "location_lat", "location_lng", "location_name",
        "template_name", "status", "created_at",
      ])
      .where("conversation_id", "=", conversationId)
      .where("username",        "=", username)
      .where("is_deleted",      "=", 0)
      .orderBy("created_at", "asc")
      .execute();

    // Add IST timestamp to each row
    const rows = messages.map((m) => ({
      ...m,
      created_at_ist: toIST(m.created_at),
    }));

    const contactLabel = conv.contact_name ?? conv.receiver_id ?? conversationId;
    const safeLabel    = contactLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
    const dateStamp    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // ── JSON export ───────────────────────────────────────
    if (format === "json") {
      reply.header("Content-Type", "application/json");
      reply.header(
        "Content-Disposition",
        `attachment; filename="chat_${safeLabel}_${dateStamp}.json"`,
      );
      return reply.send(
        JSON.stringify({
          exported_at:     toIST(new Date()),
          conversation_id: conversationId,
          channel:         conv.channel,
          contact:         conv.contact_name ?? null,
          contact_number:  conv.receiver_id,
          total_messages:  rows.length,
          messages:        rows,
        }, null, 2),
      );
    }

    // ── CSV export ────────────────────────────────────────
    const csvHeaders = CSV_COLUMNS.map((c) => c.label);
    const csvRows    = rows.map((m) =>
      CSV_COLUMNS.map((c) => formatValue(m[c.key])),
    );

    // Build CSV string using csv-stringify
    const csvString = await new Promise<string>((resolve, reject) => {
      stringify(
        [csvHeaders, ...csvRows],
        { cast: { boolean: (v) => (v ? "true" : "false") } },
        (err, output) => {
          if (err) reject(err);
          else resolve(output ?? "");
        },
      );
    });

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header(
      "Content-Disposition",
      `attachment; filename="chat_${safeLabel}_${dateStamp}.csv"`,
    );
    // UTF-8 BOM so Excel opens it correctly
    return reply.send("\uFEFF" + csvString);

  } catch (err: any) {
    console.error("[export-chat]", err?.message);
    return reply.status(500).send({ status: 0, message: "Export failed" });
  }
};
