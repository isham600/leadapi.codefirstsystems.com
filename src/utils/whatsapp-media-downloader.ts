import axios from "axios";
import fs   from "fs";
import path from "path";
import { db } from "../models/db.js";

// ── MIME → file extension ─────────────────────────────────
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg":    "jpg",
  "image/png":     "png",
  "image/webp":    "webp",
  "image/gif":     "gif",
  "video/mp4":     "mp4",
  "video/3gpp":    "3gp",
  "audio/ogg":     "ogg",
  "audio/mpeg":    "mp3",
  "audio/mp4":     "m4a",
  "audio/aac":     "aac",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain":    "txt",
};

// ── message type → local folder name ─────────────────────
const TYPE_TO_FOLDER: Record<string, string> = {
  image:    "image",
  video:    "video",
  audio:    "audio",
  document: "document",
  sticker:  "other",
};

function getExt(mime: string | null): string {
  if (!mime) return "bin";
  return MIME_TO_EXT[mime] ?? mime.split("/")[1]?.split(";")[0] ?? "bin";
}

export interface MediaDownloadResult {
  mediaUrl:   string;
  localPath:  string;
  sizeBytes:  number;
  mimeType:   string;
}

// ============================================================
// downloadWhatsAppMedia
//   1. Fetch access token from whatsapp_accounts
//   2. Exchange media_id → download URL via Meta Graph API
//   3. Download binary → save to uploads/whatsapp/media/webhook/{type}/
//   4. Return accessible URL + local path + size
// ============================================================
export async function downloadWhatsAppMedia(params: {
  username:  string;
  messageId: string;
  mediaId:   string;
  mediaType: string;
  mediaMime: string | null;
}): Promise<MediaDownloadResult | null> {
  try {
    // ── 1. Get account credentials from whatsapp_accounts ──
    const account: any = await (db as any)
      .selectFrom("whatsapp_accounts")
      .select(["url", "access_token", "access_token_type"])
      .where("username", "=", params.username)
      .where("status",   "=", "active")
      .orderBy("created_at", "desc")
      .executeTakeFirst();

    if (!account?.access_token) {
      console.warn(`[wa-media] No active WhatsApp account for ${params.username}`);
      return null;
    }

    const token     = account.access_token as string;
    const tokenType = (account.access_token_type as string | null)?.toLowerCase() ?? "bearer";

    // Build Authorization header value based on token type
    // e.g. "bearer" → "Bearer <token>",  "apikey" → "ApiKey <token>",  else → "Bearer <token>"
    function buildAuthHeader(type: string, t: string): string {
      if (type === "apikey") return `ApiKey ${t}`;
      return `Bearer ${t}`;
    }

    const authHeader = buildAuthHeader(tokenType, token);

    // Base graph URL — use account.url if set (custom/on-prem), else default Meta Graph API
    const graphBase = (account.url as string | null)?.replace(/\/$/, "")
      ?? "https://graph.facebook.com/v19.0";

    // ── 2. Get media metadata + download URL ─────────────
    const metaRes = await axios.get<{ url?: string; mime_type?: string }>(
      `${graphBase}/${params.mediaId}`,
      {
        headers: { Authorization: authHeader },
        timeout: 15_000,
      },
    );

    const downloadUrl: string | undefined = metaRes.data?.url;
    if (!downloadUrl) {
      console.warn(`[wa-media] No URL returned for media_id=${params.mediaId}`);
      return null;
    }

    const mimeType: string = metaRes.data?.mime_type ?? params.mediaMime ?? "application/octet-stream";

    // ── 3. Download binary ────────────────────────────────
    const fileRes = await axios.get<ArrayBuffer>(downloadUrl, {
      headers:      { Authorization: authHeader },
      responseType: "arraybuffer",
      timeout:      120_000,
    });

    const buffer    = Buffer.from(fileRes.data);
    const sizeBytes = buffer.length;

    // ── 4. Build target path ──────────────────────────────
    const folder   = TYPE_TO_FOLDER[params.mediaType] ?? "other";
    const ext      = getExt(mimeType);
    const safeMsgId = params.messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename  = `${safeMsgId}_${Date.now()}.${ext}`;
    const dirPath   = path.join(process.cwd(), "uploads", "whatsapp", "media", "webhook", folder);
    const filePath  = path.join(dirPath, filename);

    // ── 5. Ensure directory exists ────────────────────────
    fs.mkdirSync(dirPath, { recursive: true });

    // ── 6. Write file to disk ─────────────────────────────
    fs.writeFileSync(filePath, buffer);

    // ── 7. Build accessible URL using BASE_URL from env ──
    const baseUrl  = (process.env.BASE_URL ?? "http://localhost:3004").replace(/\/$/, "");
    const mediaUrl = `${baseUrl}/uploads/whatsapp/media/webhook/${folder}/${filename}`;

    console.log(`[wa-media] Saved ${params.mediaType} (${sizeBytes} bytes) → ${filePath}`);
    return { mediaUrl, localPath: filePath, sizeBytes, mimeType };

  } catch (err: any) {
    console.error(`[wa-media] Download failed for media_id=${params.mediaId}:`, err?.message);
    return null;
  }
}
