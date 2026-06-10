import type { FastifyRequest, FastifyReply } from "fastify";
import { randomInt } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { existsSync }       from "fs";
import path                 from "path";
import { db }               from "../../../models/db.js";
import { campaignInsertQueue } from "../../../queues/campaign.queue.js";
import type { CampaignRow }    from "../../../workers/whatsapp-campaign.worker.js";

// ── constants ─────────────────────────────────────────────────
const CHUNK_SIZE    = 500;   // rows per BullMQ job
const UPLOADS_ROOT  = path.join(process.cwd(), "uploads");

// ── helpers ───────────────────────────────────────────────────

function generateRequestId(): string {
  return `lead-waba-${Date.now()}${randomInt(1000, 9999)}`;
}

function mediaMimeSubdir(mimetype: string): string {
  if (mimetype.startsWith("image/"))  return "image";
  if (mimetype.startsWith("video/"))  return "video";
  if (
    mimetype === "application/pdf" ||
    mimetype.includes("word") ||
    mimetype.includes("document") ||
    mimetype.includes("spreadsheet") ||
    mimetype.includes("presentation")
  ) return "documents";
  return "other";
}

async function saveUploadedFile(
  buffer: Buffer,
  originalName: string,
  _mimetype: string,
  subdir: string,
): Promise<string> {
  const dir = path.join(UPLOADS_ROOT, "whatsapp", "media", subdir);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const ext      = path.extname(originalName) || "";
  const safeName = `${Date.now()}_${randomInt(10000, 99999)}${ext}`;
  await writeFile(path.join(dir, safeName), buffer);
  const baseUrl = (process.env.BASE_URL ?? "").replace(/\/$/, "");
  return `${baseUrl}/uploads/whatsapp/media/${subdir}/${safeName}`;
}

/** Very lightweight CSV parser — handles quoted fields, \r\n and \n */
function parseCSV(buffer: Buffer): string[][] {
  const text  = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter(l => l.trim());
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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ── build row data ────────────────────────────────────────────

function buildRowsFromCSV(
  csvRows:      string[][],
  defaultMedia: string | null,
  hasCsvMedia:  boolean,
  hasCsvAttrs:  boolean,
  hasDynUrl:    boolean,
  dynUrlCount:  number,
): CampaignRow[] {
  const rows: CampaignRow[] = [];

  for (const cols of csvRows) {
    const receiver = cols[0]?.replace(/\D/g, "");      // keep digits only
    if (!receiver || receiver.length < 7) continue;    // skip empty / header

    let colIdx = 1;                                     // already consumed col[0]

    // media1
    let media1: string | null = null;
    if (hasCsvMedia) {
      media1 = cols[colIdx]?.trim() || null;
      colIdx++;
    } else {
      media1 = defaultMedia;
    }

    // attributes (up to 10) → media2 … media11
    const attrs: (string | null)[] = Array(10).fill(null);
    if (hasCsvAttrs) {
      const attrEnd = hasDynUrl ? cols.length - dynUrlCount : cols.length;
      for (let i = colIdx; i < attrEnd && i - colIdx < 10; i++) {
        attrs[i - colIdx] = cols[i]?.trim() || null;
      }
    }

    // dynamic URLs → media12, media13
    let media12: string | null = null;
    let media13: string | null = null;
    if (hasDynUrl && dynUrlCount >= 1) {
      media12 = cols[cols.length - dynUrlCount]?.trim() || null;
    }
    if (hasDynUrl && dynUrlCount >= 2) {
      media13 = cols[cols.length - dynUrlCount + 1]?.trim() || null;
    }

    rows.push({
      receiver,
      media1,
      media2:  attrs[0],  media3:  attrs[1],  media4:  attrs[2],
      media5:  attrs[3],  media6:  attrs[4],  media7:  attrs[5],
      media8:  attrs[6],  media9:  attrs[7],  media10: attrs[8],
      media11: attrs[9],  media12, media13,
    });
  }

  return rows;
}

function buildRowsFromNumbers(
  numbers:      string[],
  defaultMedia: string | null,
  attrs:        (string | null)[],
  dynUrl1:      string | null,
  dynUrl2:      string | null,
): CampaignRow[] {
  return numbers
    .map(n => n.replace(/\D/g, ""))
    .filter(n => n.length >= 7)
    .map(receiver => ({
      receiver,
      media1:  defaultMedia,
      media2:  attrs[0] ?? null,  media3:  attrs[1] ?? null,  media4:  attrs[2] ?? null,
      media5:  attrs[3] ?? null,  media6:  attrs[4] ?? null,  media7:  attrs[5] ?? null,
      media8:  attrs[6] ?? null,  media9:  attrs[7] ?? null,  media10: attrs[8] ?? null,
      media11: attrs[9] ?? null,
      media12: dynUrl1,
      media13: dynUrl2,
    }));
}

// ============================================================
// POST /campaign/submit
// ============================================================
export const submitCampaign = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = req.user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
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

  // ── 1. Parse multipart form ────────────────────────────────
  const fields: Record<string, string> = {};
  const files: Record<string, { buffer: Buffer; filename: string; mimetype: string }> = {};

  try {
    for await (const part of (req as any).parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        files[part.fieldname] = {
          buffer:   buf,
          filename: part.filename ?? "file",
          mimetype: part.mimetype ?? "application/octet-stream",
        };
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }
  } catch (err) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "Invalid multipart form", data: null });
  }

  // ── 2. Validate required fields ───────────────────────────
  const campaignName = fields["campaign_name"]?.trim();
  const templateName = fields["template_name"]?.trim();
  const templateType = fields["template_type"]?.trim();

  if (!campaignName) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "campaign_name is required", data: null });
  }
  if (!templateName) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "template_name is required", data: null });
  }
  if (!templateType) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "template_type is required", data: null });
  }

  // ── 3. Dates ───────────────────────────────────────────────
  const now           = new Date();
  const scheduledDate = fields["scheduled_date"]?.trim() || now.toISOString().slice(0, 10);
  const scheduledTime = fields["scheduled_time"]?.trim() || null;

  // ── 4. CSV flags ───────────────────────────────────────────
  const hasCsvMedia  = fields["csv-contain-media"]       === "1";
  const hasCsvAttrs  = fields["csv-contain-attributes"]  === "1";
  const hasDynUrl    = fields["csv-contain-dynamic-url"] === "1";
  const dynUrlCount  = Math.min(2, parseInt(fields["csv-contain-dynamic-url-count"] ?? "0", 10) || 0);

  // ── 5. Resolve default media URL ─────────────────────────
  let defaultMediaUrl: string | null = null;

  if (files["media_file"]?.buffer.length) {
    const f      = files["media_file"];
    const subdir = mediaMimeSubdir(f.mimetype);
    defaultMediaUrl = await saveUploadedFile(f.buffer, f.filename, f.mimetype, subdir);
  } else if (fields["media_file_url"]?.trim()) {
    defaultMediaUrl = fields["media_file_url"].trim();
  }

  // ── 6. Save CSV file if present ───────────────────────────
  let csvRows: string[][] = [];
  let hasCsvFile = false;

  if (files["csv-file"]?.buffer.length) {
    const csvDir = path.join(UPLOADS_ROOT, "whatsapp", "media", "csv");
    if (!existsSync(csvDir)) await mkdir(csvDir, { recursive: true });
    const safeName = `${Date.now()}_${randomInt(10000, 99999)}.csv`;
    await writeFile(path.join(csvDir, safeName), files["csv-file"].buffer);

    csvRows    = parseCSV(files["csv-file"].buffer);
    hasCsvFile = true;
  }

  // ── 7. Build row array ────────────────────────────────────
  let rows: CampaignRow[] = [];

  if (hasCsvFile) {
    rows = buildRowsFromCSV(csvRows, defaultMediaUrl, hasCsvMedia, hasCsvAttrs, hasDynUrl, dynUrlCount);
  } else {
    const rawNumbers = (fields["numbers"] ?? "").split("\n").map(n => n.trim()).filter(Boolean);
    const attrs: (string | null)[] = Array.from({ length: 10 }, (_, i) =>
      fields[`attribute${i + 1}`]?.trim() || fields[`attributes${i + 1}`]?.trim() || null
    );
    const dynUrl1 = fields["csv-dynamic-url1"]?.trim() || null;
    const dynUrl2 = fields["csv-dynamic-url2"]?.trim() || null;

    rows = buildRowsFromNumbers(rawNumbers, defaultMediaUrl, attrs, dynUrl1, dynUrl2);
  }

  if (rows.length === 0) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "No valid phone numbers found", data: null });
  }

  // ── 8. Generate request ID ────────────────────────────────
  const requestId = generateRequestId();

  // ── 9. Insert whatsapp_camp_summury (synchronous — user sees this immediately) ──
  await (db as any)
    .insertInto("whatsapp_camp_summury")
    .values({
      request_id:     requestId,
      username:       accountUsername,
      campaign:       campaignName,
      template:       templateName,
      template_type:  templateType,
      audience:       rows.length,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      status:         "pending",
      created_at:     now,
      updated_at:     now,
    })
    .execute();

  // ── 10. Insert whatsapp_insert_job (tracking row) ─────────
  const chunks      = chunkArray(rows, CHUNK_SIZE);
  const totalChunks = chunks.length;

  await (db as any)
    .insertInto("whatsapp_insert_job")
    .values({
      request_id:   requestId,
      username:     accountUsername,
      status:       "pending",
      total:        rows.length,
      processed:    0,
      failed_count: 0,
      error:        null,
      created_at:   now,
      updated_at:   now,
    })
    .execute();

  // ── 11. Queue BullMQ jobs (background — one job per chunk) ─
  for (let i = 0; i < chunks.length; i++) {
    await campaignInsertQueue.add(
      `insert-${requestId}-chunk-${i}`,
      {
        requestId,
        username: accountUsername,
        campaignName,
        templateId:   templateName,
        scheduleDate: scheduledDate,
        scheduleTime: scheduledTime,
        chunkIndex:   i,
        totalChunks,
        rows:         chunks[i],
      },
      { priority: 1 }
    );
  }

  // ── 12. Return immediately ────────────────────────────────
  return reply.status(202).send({
    status:     1,
    statuscode: 202,
    message:    "Campaign submitted successfully. Numbers are being processed in background.",
    data: {
      requestId,
      campaignName,
      templateName,
      audience:   rows.length,
      chunks:     totalChunks,
      scheduledDate,
      scheduledTime,
    },
  });
};

// ── GET /whatsapp/campaigns/:requestId/details ────────────────
export const getWhatsappCampaignDetails = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

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

  const { requestId } = req.params as { requestId: string };
  const query = req.query as { page?: string; limit?: string; status?: string; search?: string };
  const page   = Math.max(1, Number(query.page  ?? 1));
  const limit  = Math.min(500, Math.max(1, Number(query.limit ?? 50)));
  const offset = (page - 1) * limit;
  const search = query.search?.trim() ?? "";

  let q = (db as any)
    .selectFrom("whatsapp_camp_details")
    .select([
      "id", "receiver", "whatsappid", "name", "template_id", "status",
      "delivery_date", "delivery_time", "dat", "tim",
      "schedule_date", "schedule_time",
      "media1", "media2", "media3", "media4", "media5", "media6", "media7",
      "media8", "media9", "media10", "media11", "media12", "media13",
      "masterreseller",
      "created_at", "updated_at",
    ])
    .where("username",   "=", accountUsername)
    .where("request_id", "=", requestId);

  if (query.status) {
    const st = query.status;
    if (st === "PP" || st === "59") {
      q = q.where("status", "like", `${st}%`);
    } else {
      q = q.where("status", "=", st);
    }
  }
  if (search) {
    q = q.where((eb: any) => eb.or([
      eb("receiver", "like", `%${search}%`),
      eb("name",     "like", `%${search}%`),
    ]));
  }

  let countQ = (db as any)
    .selectFrom("whatsapp_camp_details")
    .select((eb: any) => [eb.fn.count("id").as("total")])
    .where("username",   "=", accountUsername)
    .where("request_id", "=", requestId);
  if (query.status) {
    const st = query.status;
    if (st === "PP" || st === "59") {
      countQ = countQ.where("status", "like", `${st}%`);
    } else {
      countQ = countQ.where("status", "=", st);
    }
  }
  if (search) {
    countQ = countQ.where((eb: any) => eb.or([
      eb("receiver", "like", `%${search}%`),
      eb("name",     "like", `%${search}%`),
    ]));
  }

  const [rows, countRow] = await Promise.all([
    q.orderBy("created_at", "asc").limit(limit).offset(offset).execute(),
    countQ.executeTakeFirst(),
  ]);

  // Status breakdown counts
  const breakdown: any[] = await (db as any)
    .selectFrom("whatsapp_camp_details")
    .select((eb: any) => [
      "status",
      eb.fn.count("id").as("count"),
    ])
    .where("username",   "=", accountUsername)
    .where("request_id", "=", requestId)
    .groupBy("status")
    .execute();

  const stats: Record<string, number> = {};
  for (const b of breakdown) stats[b.status ?? "unknown"] = Number(b.count);

  return reply.send({
    status: 1,
    data: {
      list:       rows,
      total:      Number(countRow?.total ?? 0),
      page,
      limit,
      stats,
    },
  });
};

// ── GET /whatsapp/campaigns ────────────────────────────────────
export const getWhatsappCampaigns = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = (req as any).user?.username;
  if (!username) return reply.code(401).send({ status: 0, message: "Unauthorized" });

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

  const query = req.query as { page?: string; limit?: string; status?: string; search?: string; date_from?: string; date_to?: string };
  const page      = Math.max(1, Number(query.page  ?? 1));
  const limit     = Math.min(200, Math.max(1, Number(query.limit ?? 20)));
  const offset    = (page - 1) * limit;
  const search    = query.search?.trim() ?? "";
  const dateFrom  = query.date_from?.trim() ?? "";   // "YYYY-MM-DD"
  const dateTo    = query.date_to?.trim()   ?? "";   // "YYYY-MM-DD"

  const applyFilters = (qb: any) => {
    if (query.status) qb = qb.where("status", "=", query.status);
    if (search) {
      qb = qb.where((eb: any) => eb.or([
        eb("campaign",   "like", `%${search}%`),
        eb("template",   "like", `%${search}%`),
        eb("request_id", "like", `%${search}%`),
      ]));
    }
    if (dateFrom) qb = qb.where("scheduled_date", ">=", dateFrom);
    if (dateTo)   qb = qb.where("scheduled_date", "<=", dateTo);
    return qb;
  };

  let q = applyFilters(
    (db as any).selectFrom("whatsapp_camp_summury").selectAll().where("username", "=", accountUsername)
  );

  const countQ = applyFilters(
    (db as any)
      .selectFrom("whatsapp_camp_summury")
      .select((eb: any) => [eb.fn.count("id").as("total")])
      .where("username", "=", accountUsername)
  );

  // Status breakdown — from whatsapp_camp_details (actual delivery statuses)
  // respects date range but not status filter
  let breakdownQ = (db as any)
    .selectFrom("whatsapp_camp_details")
    .select((eb: any) => ["status", eb.fn.count("id").as("count")])
    .where("username", "=", accountUsername);
  if (dateFrom) breakdownQ = breakdownQ.where("schedule_date", ">=", dateFrom);
  if (dateTo)   breakdownQ = breakdownQ.where("schedule_date", "<=", dateTo);

  const [rows, countRow, breakdown] = await Promise.all([
    q.orderBy("created_at", "desc").limit(limit).offset(offset).execute(),
    countQ.executeTakeFirst(),
    breakdownQ.groupBy("status").execute(),
  ]);

  // All known statuses — always present even if 0
  const ALL_STATUSES = ["PP", "59", "sent", "delivered", "read", "failed", "invalid", "blocked", "incapable", "1"];
  const statusBreakdown: Record<string, number> = Object.fromEntries(ALL_STATUSES.map(s => [s, 0]));

  for (const b of breakdown) {
    const st: string = b.status ?? "unknown";
    const stLower = st.toLowerCase();
    // Group PP* → "PP", 59* → "59"
    if (stLower.startsWith("pp"))       statusBreakdown["PP"]  = (statusBreakdown["PP"]  || 0) + Number(b.count);
    else if (stLower.startsWith("59"))  statusBreakdown["59"]  = (statusBreakdown["59"]  || 0) + Number(b.count);
    else if (statusBreakdown[st] !== undefined) statusBreakdown[st] = Number(b.count);
    else statusBreakdown[st] = Number(b.count);
  }

  return reply.send({
    status: 1,
    data: {
      list:             rows,
      total:            Number(countRow?.total ?? 0),
      page,
      limit,
      status_breakdown: statusBreakdown,
    },
  });
};
