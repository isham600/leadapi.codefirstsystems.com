import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { canAccessLead } from "../utils/leadAccess.js";

// Resolve the owning account username (agents write under the parent account)
async function resolveAccount(username: string, userType?: number): Promise<string> {
  if (userType === 5) {
    const parent: any = await (db as any)
      .selectFrom("users").select(["parent_username"])
      .where("username", "=", username).executeTakeFirst();
    return parent?.parent_username ?? username;
  }
  return username;
}

// GET /api/leads/:leadId/notes
export const getLeadNotes = async (
  req: FastifyRequest<{ Params: { leadId: string } }>,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;
    if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized user", error: "unauthorized", data: null });

    const leadId = Number(req.params.leadId);
    if (!(await canAccessLead(req, leadId))) {
      return reply.status(404).send({ status: 0, statuscode: 404, message: "Lead not found", error: "lead_not_found", data: null });
    }

    const notes = await (db as any)
      .selectFrom("lead_notes")
      .select(["id", "note", "author", "created_at"])
      .where("lead_id", "=", leadId)
      .orderBy("created_at", "desc")
      .execute();

    return reply.status(200).send({ status: 1, statuscode: 200, message: "OK", error: null, data: notes });
  } catch (error: any) {
    req.log.error(error);
    return reply.status(500).send({ status: 0, statuscode: 500, message: "Server error", error: "server_error", data: null });
  }
};

// POST /api/leads/:leadId/notes  { note }
export const createLeadNote = async (
  req: FastifyRequest<{ Params: { leadId: string }; Body: { note?: string } }>,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;
    if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized user", error: "unauthorized", data: null });

    const leadId = Number(req.params.leadId);
    const note = (req.body?.note ?? "").trim();
    if (!note) return reply.status(400).send({ status: 0, statuscode: 400, message: "note is required", error: "validation_error", data: null });

    if (!(await canAccessLead(req, leadId))) {
      return reply.status(404).send({ status: 0, statuscode: 404, message: "Lead not found", error: "lead_not_found", data: null });
    }

    const userType = (req.user as any)?.user_type as number | undefined;
    const accountUsername = await resolveAccount(username, userType);

    const res: any = await (db as any)
      .insertInto("lead_notes")
      .values({ lead_id: leadId, username: accountUsername, author: username, note, created_at: new Date(), updated_at: new Date() })
      .executeTakeFirst();

    const id = res?.insertId != null ? Number(res.insertId) : null;
    return reply.status(200).send({
      status: 1, statuscode: 200, message: "Note added", error: null,
      data: { id, note, author: username, created_at: new Date() },
    });
  } catch (error: any) {
    req.log.error(error);
    return reply.status(500).send({ status: 0, statuscode: 500, message: "Server error", error: "server_error", data: null });
  }
};

// DELETE /api/leads/:leadId/notes/:noteId
export const deleteLeadNote = async (
  req: FastifyRequest<{ Params: { leadId: string; noteId: string } }>,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;
    if (!username) return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized user", error: "unauthorized", data: null });

    const leadId = Number(req.params.leadId);
    const noteId = Number(req.params.noteId);
    if (!(await canAccessLead(req, leadId))) {
      return reply.status(404).send({ status: 0, statuscode: 404, message: "Lead not found", error: "lead_not_found", data: null });
    }

    const userType = (req.user as any)?.user_type as number | undefined;
    const accountUsername = await resolveAccount(username, userType);

    await (db as any)
      .deleteFrom("lead_notes")
      .where("id", "=", noteId)
      .where("lead_id", "=", leadId)
      .where("username", "=", accountUsername)
      .execute();

    return reply.status(200).send({ status: 1, statuscode: 200, message: "Note deleted", error: null, data: null });
  } catch (error: any) {
    req.log.error(error);
    return reply.status(500).send({ status: 0, statuscode: 500, message: "Server error", error: "server_error", data: null });
  }
};
