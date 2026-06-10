import type { FastifyRequest, FastifyReply } from "fastify";
import axios from "axios";
import fs   from "fs";
import path from "path";
import { db } from "../../../models/db.js";
import { saveMessage, upsertSummary } from "../../../utils/webhook-processor.js";

// ── Agent hierarchy: resolve master account username ─────
async function resolveUsername(req: FastifyRequest): Promise<string | null> {
  const username = req.user?.username;
  if (!username) return null;
  const userType = (req.user as any)?.user_type as number | undefined;
  if (userType === 5) {
    const row: any = await (db as any)
      .selectFrom("users").select(["parent_username"])
      .where("username", "=", username).executeTakeFirst();
    return row?.parent_username ?? username;
  }
  return username;
}

// ── Auth header helper ────────────────────────────────────
function buildAuthHeader(tokenType: string | null, token: string): string {
  const type = (tokenType ?? "bearer").toLowerCase();
  if (type === "apikey") return `ApiKey ${token}`;
  return `Bearer ${token}`;
}

// ── MIME → folder + extension ─────────────────────────────
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4",  "video/3gpp": "3gp",
  "audio/ogg": "ogg",  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

function mimeToFolder(mime: string): string {
  if (mime.startsWith("image/"))       return "image";
  if (mime.startsWith("video/"))       return "video";
  if (mime.startsWith("audio/"))       return "audio";
  return "document";
}

function getExt(mime: string): string {
  return MIME_TO_EXT[mime] ?? mime.split("/")[1]?.split(";")[0] ?? "bin";
}

// ── Build WhatsApp message payload ────────────────────────
function buildWaPayload(to: string, msg: SendBody): Record<string, any> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };

  switch (msg.type) {
    case "text":
      return { ...base, type: "text", text: { body: msg.text ?? "", preview_url: msg.preview_url ?? false } };

    case "image":
      return { ...base, type: "image", image: { link: msg.media_url, ...(msg.caption ? { caption: msg.caption } : {}) } };

    case "video":
      return { ...base, type: "video", video: { link: msg.media_url, ...(msg.caption ? { caption: msg.caption } : {}) } };

    case "audio":
      return { ...base, type: "audio", audio: { link: msg.media_url } };

    case "document":
      return { ...base, type: "document", document: {
        link: msg.media_url,
        ...(msg.media_filename ? { filename: msg.media_filename } : {}),
        ...(msg.caption        ? { caption:  msg.caption        } : {}),
      }};

    case "template":
      return { ...base, type: "template", template: {
        name:     msg.template_name,
        language: { code: msg.template_lang ?? "en" },
        ...(msg.template_components?.length ? { components: msg.template_components } : {}),
      }};

    default:
      throw new Error(`Unsupported type: ${(msg as any).type}`);
  }
}

// ── Shared send logic ─────────────────────────────────────
async function doSend(params: {
  uuid:           string;
  username:       string;
  conversationId: string;
  msg:            SendBody;
}): Promise<{ wamid: string | null }> {
  const { uuid, username, conversationId, msg } = params;

  // 1. Get conversation (sender_id = our biz number, receiver_id = contact)
  const conv: any = await (db as any)
    .selectFrom("chat_message_summary")
    .select(["sender_id", "receiver_id", "channel", "contact_name"])
    .where("conversation_id", "=", conversationId)
    .where("username",        "=", username)
    .executeTakeFirst();

  if (!conv) throw Object.assign(new Error("Conversation not found"), { statusCode: 404 });
  if (!["whatsapp"].includes(conv.channel))
    throw Object.assign(new Error(`Use channel-specific send for: ${conv.channel}`), { statusCode: 400 });

  // 2. Get WhatsApp account credentials
  const account: any = await (db as any)
    .selectFrom("whatsapp_accounts")
    .select(["phone_number_id", "url", "access_token", "access_token_type"])
    .where("username", "=", username)
    .where("status",   "=", "active")
    .orderBy("created_at", "desc")
    .executeTakeFirst();

  if (!account?.access_token || !account?.phone_number_id)
    throw Object.assign(new Error("No active WhatsApp account configured"), { statusCode: 400 });

  const authHeader = buildAuthHeader(account.access_token_type, account.access_token);
  const graphBase  = (account.url as string | null)?.replace(/\/$/, "") ?? "https://graph.facebook.com/v19.0";
  const toNumber   = conv.receiver_id as string;
  const bizNumber  = conv.sender_id   as string;

  // 3. Build & send to WhatsApp API
  const waPayload = buildWaPayload(toNumber, msg);
  const res = await axios.post<{ messages?: Array<{ id: string }> }>(
    `${graphBase}/${account.phone_number_id}/messages`,
    waPayload,
    { headers: { Authorization: authHeader, "Content-Type": "application/json" }, timeout: 15_000 },
  );

  const wamid   = res.data?.messages?.[0]?.id ?? null;
  const preview = msg.type === "text"
    ? (msg.text?.slice(0, 200) ?? null)
    : msg.type === "template"
      ? `[template: ${msg.template_name}]`
      : `[${msg.type}]`;

  // 4. Save outbound message
  await saveMessage({
    uuid, username,
    channel:         "whatsapp",
    conversation_id: conversationId,
    message_id:      wamid,
    sender_id:       bizNumber,
    receiver_id:     toNumber,
    contact_name:    conv.contact_name ?? null,
    type:            msg.type,
    text:            msg.text ?? msg.caption ?? null,
    media_url:       msg.media_url ?? null,
    media_filename:  msg.media_filename ?? null,
    template_name:   msg.template_name ?? null,
    template_lang:   msg.template_lang ?? null,
    direction:       "outbound",
    status:          "sent",
  });

  // 5. Update sidebar summary
  await upsertSummary({
    uuid, username,
    conversation_id:   conversationId,
    channel:           "whatsapp",
    sender_id:         bizNumber,
    receiver_id:       toNumber,
    contact_name:      conv.contact_name ?? null,
    last_message:      preview,
    last_message_type: msg.type,
    last_message_dir:  "outbound",
  });

  return { wamid };
}

// ── Build RCS message payload (Google RBM) ────────────────
function buildRcsPayload(messageId: string, msg: SendBody): Record<string, any> {
  switch (msg.type) {
    case "text":
      return {
        messageId,
        contentMessage: { text: msg.text ?? "" },
      };

    case "image":
      return {
        messageId,
        contentMessage: {
          richCard: {
            standaloneCard: {
              cardOrientation: "HORIZONTAL",
              cardContent: {
                ...(msg.caption ? { description: msg.caption } : {}),
                media: {
                  height: "MEDIUM",
                  contentInfo: { fileUrl: msg.media_url, forceRefresh: false },
                },
              },
            },
          },
        },
      };

    case "video":
    case "document":
      return {
        messageId,
        contentMessage: {
          richCard: {
            standaloneCard: {
              cardOrientation: "HORIZONTAL",
              cardContent: {
                ...(msg.caption ? { description: msg.caption } : {}),
                media: {
                  height: "MEDIUM",
                  contentInfo: { fileUrl: msg.media_url, forceRefresh: false },
                },
              },
            },
          },
        },
      };

    default:
      throw new Error(`Unsupported RCS type: ${(msg as any).type}`);
  }
}

// ── Send RCS message via Google RBM API ───────────────────
async function doSendRcs(params: {
  uuid:           string;
  username:       string;
  conversationId: string;
  msg:            SendBody;
}): Promise<{ messageId: string | null }> {
  const { uuid, username, conversationId, msg } = params;

  // 1. Get conversation
  const conv: any = await (db as any)
    .selectFrom("chat_message_summary")
    .select(["sender_id", "receiver_id", "channel", "contact_name"])
    .where("conversation_id", "=", conversationId)
    .where("username",        "=", username)
    .executeTakeFirst();

  if (!conv) throw Object.assign(new Error("Conversation not found"), { statusCode: 404 });

  // 2. Get RCS account credentials
  const account: any = await (db as any)
    .selectFrom("rcs_accounts")
    .select(["agent_id", "api_key"])
    .where("username", "=", username)
    .where("status",   "=", "active")
    .orderBy("created_at", "desc")
    .executeTakeFirst();

  if (!account?.api_key)
    throw Object.assign(new Error("No active RCS account configured"), { statusCode: 400 });

  // receiver_id stored without +, RBM API requires E.164 with +
  const toNumber  = conv.receiver_id.startsWith("+") ? conv.receiver_id : `+${conv.receiver_id}`;
  const agentId   = conv.sender_id;   // sender_id = RCS agentId for this conversation
  const msgId     = `rcs-out-${uuid}-${Date.now()}`;
  const rcsPayload = buildRcsPayload(msgId, msg);

  const rbmBase = "https://rcsbusinessmessaging.googleapis.com/v1";
  const res = await axios.post(
    `${rbmBase}/phones/${encodeURIComponent(toNumber)}/agentMessages?key=${account.api_key}`,
    rcsPayload,
    { headers: { "Content-Type": "application/json" }, timeout: 15_000 },
  );

  const sentMsgId = (res.data as any)?.name?.split("/").pop() ?? msgId;
  const preview   = msg.type === "text"
    ? (msg.text?.slice(0, 200) ?? null)
    : `[${msg.type}${msg.media_url ? "" : ""}]`;

  // 3. Save outbound message
  await saveMessage({
    uuid, username,
    channel:         "rcs",
    conversation_id: conversationId,
    message_id:      sentMsgId,
    sender_id:       agentId,
    receiver_id:     conv.receiver_id,
    contact_name:    conv.contact_name ?? null,
    type:            msg.type,
    text:            msg.text ?? msg.caption ?? null,
    media_url:       msg.media_url ?? null,
    media_filename:  msg.media_filename ?? null,
    direction:       "outbound",
    status:          "sent",
  });

  // 4. Update sidebar summary
  await upsertSummary({
    uuid, username,
    conversation_id:   conversationId,
    channel:           "rcs",
    sender_id:         agentId,
    receiver_id:       conv.receiver_id,
    contact_name:      conv.contact_name ?? null,
    last_message:      preview,
    last_message_type: msg.type,
    last_message_dir:  "outbound",
  });

  return { messageId: sentMsgId };
}

// ── Supported send types ──────────────────────────────────
type SendType = "text" | "image" | "video" | "audio" | "document" | "template";

interface SendBody {
  type:                SendType;
  // text
  text?:               string;
  preview_url?:        boolean;
  // media (by URL)
  media_url?:          string;
  media_filename?:     string;
  caption?:            string;
  // template
  template_name?:      string;
  template_lang?:      string;
  template_components?: any[];
}

// ============================================================
// POST /api/webhook/auth/inbox/:conversationId/send
// Body: JSON  — text / template / media by URL
// ============================================================
export const sendMessage = async (
  req: FastifyRequest<{ Params: { conversationId: string }; Body: SendBody }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  const uuid     = req.user?.uuid;
  if (!username || !uuid) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const body = req.body;

  // Validate
  if (!body?.type) return reply.status(400).send({ status: 0, message: "type is required" });
  if (body.type === "text" && !body.text?.trim())
    return reply.status(400).send({ status: 0, message: "text is required for text messages" });
  if (["image","video","audio","document"].includes(body.type) && !body.media_url)
    return reply.status(400).send({ status: 0, message: "media_url is required for media messages" });
  if (body.type === "template" && !body.template_name)
    return reply.status(400).send({ status: 0, message: "template_name is required" });

  try {
    const { wamid } = await doSend({ uuid, username, conversationId: req.params.conversationId, msg: body });
    return reply.send({ status: 1, message: "Message sent", data: { wamid } });
  } catch (err: any) {
    const code = err?.statusCode ?? err?.response?.status ?? 500;
    const msg  = err?.response?.data?.error?.message ?? err?.message ?? "Failed to send message";
    return reply.status(code <= 599 ? code : 500).send({ status: 0, message: msg });
  }
};

// ============================================================
// POST /api/webhook/auth/inbox/:conversationId/send-rcs
// Body: JSON — text / image / video / document by URL
// ============================================================
export const sendRcsMessage = async (
  req: FastifyRequest<{ Params: { conversationId: string }; Body: SendBody }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  const uuid     = req.user?.uuid;
  if (!username || !uuid) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const body = req.body;
  if (!body?.type) return reply.status(400).send({ status: 0, message: "type is required" });
  if (body.type === "text" && !body.text?.trim())
    return reply.status(400).send({ status: 0, message: "text is required for text messages" });
  if (["image", "video", "document"].includes(body.type) && !body.media_url)
    return reply.status(400).send({ status: 0, message: "media_url is required for media messages" });

  try {
    const { messageId } = await doSendRcs({ uuid, username, conversationId: req.params.conversationId, msg: body });
    return reply.send({ status: 1, message: "RCS message sent", data: { messageId } });
  } catch (err: any) {
    const code = err?.statusCode ?? err?.response?.status ?? 500;
    const msg  = err?.response?.data?.error?.message ?? err?.message ?? "Failed to send RCS message";
    return reply.status(code <= 599 ? code : 500).send({ status: 0, message: msg });
  }
};

// ============================================================
// POST /api/webhook/auth/inbox/:conversationId/send-file
// Body: multipart/form-data  — upload file + send
// Fields: file (required), caption (optional)
// ============================================================
export const sendFile = async (
  req: FastifyRequest<{ Params: { conversationId: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  const uuid     = req.user?.uuid;
  if (!username || !uuid) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  // Parse multipart
  const data = await req.file();
  if (!data) return reply.status(400).send({ status: 0, message: "No file uploaded" });

  const mime    = data.mimetype ?? "application/octet-stream";
  const folder  = mimeToFolder(mime);
  const ext     = getExt(mime);
  const origName = (data.filename ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${Date.now()}_${origName}`;
  const dirPath  = path.join(process.cwd(), "uploads", "whatsapp", "media", "outbound", folder);
  const filePath = path.join(dirPath, filename);

  fs.mkdirSync(dirPath, { recursive: true });

  // Read caption from multipart fields (comes after file)
  let caption: string | undefined;
  try {
    // @ts-ignore — fields available on multipart parts
    const fields = (req as any).body ?? {};
    caption = fields?.caption?.value ?? undefined;
  } catch { /* optional */ }

  try {
    const buffer = await data.toBuffer();
    fs.writeFileSync(filePath, buffer);
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to save file" });
  }

  const baseUrl  = (process.env.BASE_URL ?? "http://localhost:3004").replace(/\/$/, "");
  const mediaUrl = `${baseUrl}/uploads/whatsapp/media/outbound/${folder}/${filename}`;

  // Determine message type from mime
  let msgType: SendType = "document";
  if (mime.startsWith("image/")) msgType = "image";
  else if (mime.startsWith("video/")) msgType = "video";
  else if (mime.startsWith("audio/")) msgType = "audio";

  try {
    const { wamid } = await doSend({
      uuid, username,
      conversationId: req.params.conversationId,
      msg: {
        type:           msgType,
        media_url:      mediaUrl,
        media_filename: data.filename ?? filename,
        caption,
      },
    });
    return reply.send({
      status: 1,
      message: "File sent",
      data: { wamid, media_url: mediaUrl, type: msgType, filename },
    });
  } catch (err: any) {
    // Clean up saved file on send failure
    fs.unlink(filePath, () => {});
    const code = err?.statusCode ?? err?.response?.status ?? 500;
    const msg  = err?.response?.data?.error?.message ?? err?.message ?? "Failed to send file";
    return reply.status(code <= 599 ? code : 500).send({ status: 0, message: msg });
  }
};

// ============================================================
// POST /api/webhook/auth/inbox/:conversationId/send-rcs-file
// Body: multipart/form-data — upload file + send via RCS
// Fields: file (required), caption (optional)
// ============================================================
export const sendRcsFile = async (
  req: FastifyRequest<{ Params: { conversationId: string } }>,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  const uuid     = req.user?.uuid;
  if (!username || !uuid) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const data = await req.file();
  if (!data) return reply.status(400).send({ status: 0, message: "No file uploaded" });

  const mime     = data.mimetype ?? "application/octet-stream";
  const folder   = mimeToFolder(mime);
  const origName = (data.filename ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${Date.now()}_${origName}`;
  const dirPath  = path.join(process.cwd(), "uploads", "rcs", "media", "outbound", folder);
  const filePath = path.join(dirPath, filename);

  fs.mkdirSync(dirPath, { recursive: true });

  let caption: string | undefined;
  try {
    const fields = (req as any).body ?? {};
    caption = fields?.caption?.value ?? undefined;
  } catch { /* optional */ }

  try {
    const buffer = await data.toBuffer();
    fs.writeFileSync(filePath, buffer);
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to save file" });
  }

  const baseUrl  = (process.env.BASE_URL ?? "http://localhost:3004").replace(/\/$/, "");
  const mediaUrl = `${baseUrl}/uploads/rcs/media/outbound/${folder}/${filename}`;

  let msgType: SendType = "document";
  if (mime.startsWith("image/"))      msgType = "image";
  else if (mime.startsWith("video/")) msgType = "video";
  else if (mime.startsWith("audio/")) msgType = "audio";

  try {
    const { messageId } = await doSendRcs({
      uuid, username,
      conversationId: req.params.conversationId,
      msg: {
        type:           msgType,
        media_url:      mediaUrl,
        media_filename: data.filename ?? filename,
        caption,
      },
    });
    return reply.send({
      status: 1,
      message: "File sent via RCS",
      data: { messageId, media_url: mediaUrl, type: msgType, filename },
    });
  } catch (err: any) {
    fs.unlink(filePath, () => {});
    const code = err?.statusCode ?? err?.response?.status ?? 500;
    const msg  = err?.response?.data?.error?.message ?? err?.message ?? "Failed to send RCS file";
    return reply.status(code <= 599 ? code : 500).send({ status: 0, message: msg });
  }
};

// ============================================================
// POST /api/webhook/auth/workflow/upload-media
// Body: multipart/form-data — upload a file, return public URL
// Fields: file (required)
// Used by: WhatsApp workflow node media picker
// ============================================================
export const uploadWorkflowMedia = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const username = await resolveUsername(req);
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const data = await req.file();
  if (!data) return reply.status(400).send({ status: 0, message: "No file uploaded" });

  const mime     = data.mimetype ?? "application/octet-stream";
  const folder   = mimeToFolder(mime);
  const origName = (data.filename ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${Date.now()}_${origName}`;
  const dirPath  = path.join(process.cwd(), "uploads", "workflow", "media", folder);
  const filePath = path.join(dirPath, filename);

  fs.mkdirSync(dirPath, { recursive: true });

  try {
    const buffer = await data.toBuffer();
    fs.writeFileSync(filePath, buffer);
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to save file" });
  }

  const baseUrl  = (process.env.BASE_URL ?? "http://localhost:3004").replace(/\/$/, "");
  const mediaUrl = `${baseUrl}/uploads/workflow/media/${folder}/${filename}`;

  return reply.send({
    status: 1,
    data: {
      url:      mediaUrl,
      type:     folder,   // image | video | audio | document
      mime,
      filename: data.filename ?? filename,
    },
  });
};
