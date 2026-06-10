import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { z } from "zod";

// Sender ID schema for validation
const senderIdSchema = z.object({
  sender_id: z.string().min(3).max(6),
  type: z.enum(["Promotional", "Transactional"]),
  peid: z.string().optional(),
});

// Normalize BigInt values for JSON serialization
const normalizeBigInt = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(normalizeBigInt);
  if (typeof obj === 'object') {
    const normalized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Handle date fields specifically
      if ((key === 'created_at' || key === 'updated_at') && value) {
        normalized[key] = new Date(value as any).toISOString().slice(0, 19).replace('T', ' ');
      } else {
        normalized[key] = normalizeBigInt(value);
      }
    }
    return normalized;
  }
  return obj;
};

export const createSenderId = async (req: FastifyRequest, reply: FastifyReply) => {
  const parsed = senderIdSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ 
      status: 0, 
      message: "Validation failed",
      errors: parsed.error.flatten() 
    });
  }

  try {
    // Get username from JWT
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { sender_id, type, peid } = parsed.data;

    // Convert type to number for database storage
    const typeNumber = type === "Transactional" ? 1 : 0;

    const inserted = await (db as any)
      .insertInto("smpp_sender_ids")
      .values({
        sender_id,
        username,
        type: typeNumber,
        peid: peid || null,
        status: 0, // 0 = pending, 1 = approved, 2 = rejected
        is_default: 0,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .executeTakeFirst();

    // Get the created sender ID with proper formatting
    const createdSenderId = await (db as any)
      .selectFrom("smpp_sender_ids")
      .selectAll()
      .where("username", "=", username)
      .where("sender_id", "=", sender_id)
      .executeTakeFirst();

    return reply.status(201).send({
      status: 1,
      message: "Sender ID created successfully (Pending Approval)",
      data: normalizeBigInt(createdSenderId),
    });
  } catch (err) {
    req.log.error({ err }, "❌ Create Sender ID Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to create Sender ID" 
    });
  }
};

export const getSenderIds = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    // Extract query parameters
    const query = req.query as any;
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 20;
    const search = query.search || '';
    const type = query.type || '';

    // Build the query
    let dbQuery = (db as any)
      .selectFrom("smpp_sender_ids")
      .selectAll()
      .where("username", "=", username);

    // Add search filter
    if (search) {
      dbQuery = dbQuery.where("sender_id", "like", `%${search}%`);
    }

    // Add type filter
    if (type && type !== 'all') {
      const typeNumber = type === 'transactional' ? 1 : 0;
      dbQuery = dbQuery.where("type", "=", typeNumber);
    }

    // Add pagination
    const offset = (page - 1) * limit;
    dbQuery = dbQuery
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset);

    const senderIds = await dbQuery.execute();

    // Get total count for pagination
    let countQuery = (db as any)
      .selectFrom("smpp_sender_ids")
      .select((eb: any) => eb.fn.count("id").as("count"))
      .where("username", "=", username);

    // Apply same filters to count query
    if (search) {
      countQuery = countQuery.where("sender_id", "like", `%${search}%`);
    }

    if (type && type !== 'all') {
      const typeNumber = type === 'transactional' ? 1 : 0;
      countQuery = countQuery.where("type", "=", typeNumber);
    }

    const countResult = await countQuery.executeTakeFirst();
    const total = parseInt(countResult?.count || '0');
    const totalPages = Math.ceil(total / limit);

    // Process sender IDs to ensure proper formatting
    const processedSenderIds = senderIds.map((senderId: any) => ({
      ...senderId,
      id: senderId.id.toString(),
      type_label: senderId.type === 1 ? 'Transactional' : 'Promotional',
      status_label: senderId.status === 1 ? 'Approved' : senderId.status === 2 ? 'Rejected' : 'Pending',
      created_at: senderId.created_at ? new Date(senderId.created_at).toISOString().slice(0, 19).replace('T', ' ') : null,
      updated_at: senderId.updated_at ? new Date(senderId.updated_at).toISOString().slice(0, 19).replace('T', ' ') : null
    }));

    return reply.send({
      status: 1,
      message: "Sender IDs fetched successfully",
      data: processedSenderIds,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    });
  } catch (err) {
    req.log.error({ err }, "❌ Get Sender IDs Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to fetch Sender IDs" 
    });
  }
};

export const getSenderId = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };

    const senderId = await (db as any)
      .selectFrom("smpp_sender_ids")
      .selectAll()
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (!senderId) {
      return reply.status(404).send({
        status: 0,
        message: "Sender ID not found",
      });
    }

    // Process sender ID to ensure proper formatting
    const processedSenderId = {
      ...senderId,
      id: senderId.id.toString(),
      type_label: senderId.type === 1 ? 'Transactional' : 'Promotional',
      status_label: senderId.status === 1 ? 'Approved' : senderId.status === 2 ? 'Rejected' : 'Pending',
      created_at: senderId.created_at ? new Date(senderId.created_at).toISOString().slice(0, 19).replace('T', ' ') : null,
      updated_at: senderId.updated_at ? new Date(senderId.updated_at).toISOString().slice(0, 19).replace('T', ' ') : null
    };

    return reply.send({
      status: 1,
      message: "Sender ID fetched successfully",
      data: processedSenderId,
    });
  } catch (err) {
    req.log.error({ err }, "❌ Get Sender ID Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to fetch Sender ID" 
    });
  }
};

export const updateSenderId = async (req: FastifyRequest, reply: FastifyReply) => {
  const parsed = senderIdSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ 
      status: 0, 
      message: "Validation failed",
      errors: parsed.error.flatten() 
    });
  }

  try {
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };
    const updateData: any = { updated_at: new Date() };

    // Only update allowed fields
    if (parsed.data.peid !== undefined) {
      updateData.peid = parsed.data.peid || null;
    }

    const updated = await (db as any)
      .updateTable("smpp_sender_ids")
      .set(updateData)
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (updated.numUpdatedRows === 0) {
      return reply.status(404).send({
        status: 0,
        message: "Sender ID not found",
      });
    }

    // Get the updated sender ID
    const updatedSenderId = await (db as any)
      .selectFrom("smpp_sender_ids")
      .selectAll()
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    const processedSenderId = updatedSenderId ? {
      ...updatedSenderId,
      id: updatedSenderId.id.toString(),
      type_label: updatedSenderId.type === 1 ? 'Transactional' : 'Promotional',
      status_label: updatedSenderId.status === 1 ? 'Approved' : updatedSenderId.status === 2 ? 'Rejected' : 'Pending',
      created_at: updatedSenderId.created_at ? new Date(updatedSenderId.created_at).toISOString().slice(0, 19).replace('T', ' ') : null,
      updated_at: updatedSenderId.updated_at ? new Date(updatedSenderId.updated_at).toISOString().slice(0, 19).replace('T', ' ') : null
    } : null;

    return reply.send({
      status: 1,
      message: "Sender ID updated successfully",
      data: processedSenderId,
    });
  } catch (err) {
    req.log.error({ err }, "❌ Update Sender ID Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to update Sender ID" 
    });
  }
};

export const deleteSenderId = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };

    const deleted = await (db as any)
      .deleteFrom("smpp_sender_ids")
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (deleted.numDeletedRows === 0) {
      return reply.status(404).send({
        status: 0,
        message: "Sender ID not found",
      });
    }

    return reply.send({
      status: 1,
      message: "Sender ID deleted successfully",
    });
  } catch (err) {
    req.log.error({ err }, "❌ Delete Sender ID Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to delete Sender ID" 
    });
  }
};

export const downloadSenderIdsCSV = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    // Get all sender IDs for the user
    const senderIds = await (db as any)
      .selectFrom("smpp_sender_ids")
      .selectAll()
      .where("username", "=", username)
      .orderBy("created_at", "desc")
      .execute();

    // Process data for CSV
    const csvData = senderIds.map((senderId: any) => ({
      ID: senderId.id.toString(),
      'Sender ID': senderId.sender_id,
      Type: senderId.type === 1 ? 'Transactional' : 'Promotional',
      PEID: senderId.peid || '',
      Status: senderId.status === 1 ? 'Approved' : senderId.status === 2 ? 'Rejected' : 'Pending',
      'Is Default': senderId.is_default === 1 ? 'Yes' : 'No',
      'Created At': senderId.created_at ? new Date(senderId.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
      'Updated At': senderId.updated_at ? new Date(senderId.updated_at).toISOString().slice(0, 19).replace('T', ' ') : ''
    }));

    // Convert to CSV format
    const headers = Object.keys(csvData[0] || {});
    const csvContent = [
      headers.join(','),
      ...csvData.map((row: any) => headers.map(header => `"${row[header as keyof typeof row] || ''}"`).join(','))
    ].join('\n');

    // Set headers for file download
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="sender-ids-${new Date().toISOString().slice(0, 10)}.csv"`);

    return reply.send(csvContent);
  } catch (err) {
    req.log.error({ err }, "❌ Download Sender IDs CSV Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to download Sender IDs CSV" 
    });
  }
};

export const makeDefaultSenderId = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };

    // First, check if the sender ID exists and belongs to the user
    const senderIdExists = await (db as any)
      .selectFrom("smpp_sender_ids")
      .select("id")
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (!senderIdExists) {
      return reply.status(404).send({
        status: 0,
        message: "Sender ID not found",
      });
    }

    // Start a transaction to ensure data consistency
    await (db as any).transaction().execute(async (trx: any) => {
      // First, remove default status from all sender IDs for this user
      await trx
        .updateTable("smpp_sender_ids")
        .set({ is_default: 0, updated_at: new Date() })
        .where("username", "=", username)
        .execute();

      // Then, set the selected sender ID as default
      await trx
        .updateTable("smpp_sender_ids")
        .set({ is_default: 1, updated_at: new Date() })
        .where("username", "=", username)
        .where("id", "=", parseInt(id))
        .execute();
    });

    return reply.send({
      status: 1,
      message: "Sender ID set as default successfully",
    });
  } catch (err) {
    req.log.error({ err }, "❌ Make Default Sender ID Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to set sender ID as default" 
    });
  }
};
export const removeDefaultSenderId = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = req.user?.username;
    if (!username) {
      return reply.status(401).send({ status: 0, message: "Unauthorized" });
    }

    const { id } = req.params as { id: string };

    // Check if the sender ID exists, belongs to the user, and is currently default
    const senderIdExists = await (db as any)
      .selectFrom("smpp_sender_ids")
      .select(["id", "is_default"])
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .executeTakeFirst();

    if (!senderIdExists) {
      return reply.status(404).send({
        status: 0,
        message: "Sender ID not found",
      });
    }

    if (senderIdExists.is_default !== 1) {
      return reply.status(400).send({
        status: 0,
        message: "Sender ID is not currently set as default",
      });
    }

    // Remove default status from this sender ID
    await (db as any)
      .updateTable("smpp_sender_ids")
      .set({ is_default: 0, updated_at: new Date() })
      .where("username", "=", username)
      .where("id", "=", parseInt(id))
      .execute();

    return reply.send({
      status: 1,
      message: "Default status removed successfully",
    });
  } catch (err) {
    req.log.error({ err }, "❌ Remove Default Sender ID Error");
    return reply.status(500).send({ 
      status: 0, 
      message: "Failed to remove default status" 
    });
  }
};