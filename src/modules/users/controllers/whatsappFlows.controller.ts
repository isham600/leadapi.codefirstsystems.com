import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

// ── Helpers ────────────────────────────────────────────────────────────────

async function getWabaCredentials(username: string): Promise<{ wabaId: string; accessToken: string } | null> {
  const account: any = await (db as any)
    .selectFrom("whatsapp_accounts")
    .select(["waba_id", "access_token"])
    .where("username", "=", username)
    .where("status", "=", "active")
    .orderBy("id", "desc")
    .executeTakeFirst();

  if (!account) return null;
  return { wabaId: String(account.waba_id), accessToken: account.access_token };
}

async function resolveAccountUsername(req: FastifyRequest): Promise<string> {
  const username = req.user?.username ?? "";
  const userType = (req as any).user?.user_type as number | undefined;
  if (userType === 5) {
    const row: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    return row?.parent_username ?? username;
  }
  return username;
}

// ── GET /whatsappFlows ─────────────────────────────────────────────────────

export const listWhatsappFlows = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const username = req.user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  const accountUsername = await resolveAccountUsername(req);
  const creds = await getWabaCredentials(accountUsername);
  if (!creds) {
    return reply.status(404).send({ status: 0, statuscode: 404, message: "No active WhatsApp account found", data: null });
  }

  const metaRes = await fetch(
    `https://graph.facebook.com/v20.0/${creds.wabaId}/flows?fields=id,name,categories,status,updated_at&access_token=${creds.accessToken}`
  );
  const metaData: any = await metaRes.json();

  if (metaData.error) {
    return reply.status(502).send({
      status: 0,
      statuscode: 502,
      message: metaData.error.message ?? "Meta API error",
      data: null,
    });
  }

  return reply.send({
    status: 1,
    statuscode: 200,
    message: "Flows fetched",
    data: metaData.data ?? [],
  });
};

// ── POST /whatsappFlows ────────────────────────────────────────────────────

export type CreateFlowBody = {
  name: string;
  categories: string[];  // e.g. ["SIGN_UP"] or ["APPOINTMENT_BOOKING"]
};

export const createWhatsappFlow = async (
  req: FastifyRequest<{ Body: CreateFlowBody }>,
  reply: FastifyReply
) => {
  const username = req.user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  const { name, categories } = req.body ?? {};
  if (!name?.trim()) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "Flow name is required", data: null });
  }
  if (!categories?.length) {
    return reply.status(400).send({ status: 0, statuscode: 400, message: "At least one category is required", data: null });
  }

  const accountUsername = await resolveAccountUsername(req);
  const creds = await getWabaCredentials(accountUsername);
  if (!creds) {
    return reply.status(404).send({ status: 0, statuscode: 404, message: "No active WhatsApp account found", data: null });
  }

  const body = new URLSearchParams();
  body.set("name", name.trim());
  body.set("categories", JSON.stringify(categories));

  const metaRes = await fetch(
    `https://graph.facebook.com/v20.0/${creds.wabaId}/flows`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${creds.accessToken}`,
      },
      body: body.toString(),
    }
  );
  const metaData: any = await metaRes.json();

  if (metaData.error) {
    return reply.status(502).send({
      status: 0,
      statuscode: 502,
      message: metaData.error.message ?? "Meta API error",
      data: null,
    });
  }

  return reply.status(201).send({
    status: 1,
    statuscode: 201,
    message: "Flow created",
    data: { id: metaData.id, name: name.trim(), categories },
  });
};
