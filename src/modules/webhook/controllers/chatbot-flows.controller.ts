import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

// ============================================================
// Chatbot Flows — CRUD
// ============================================================

// ── GET /auth/chatbot/flows ──────────────────────────────
// List all flows for the authenticated user, including steps
export const listFlows = async (req: FastifyRequest, reply: FastifyReply) => {
  const { uuid, username } = req.user as any;

  const flows: any[] = await (db as any)
    .selectFrom("chatbot_flows")
    .selectAll()
    .where("uuid", "=", uuid)
    .orderBy("id", "asc")
    .execute();

  // Attach steps to each flow
  const flowIds = flows.map((f: any) => f.id);
  let steps: any[] = [];
  if (flowIds.length) {
    steps = await (db as any)
      .selectFrom("chatbot_flow_steps")
      .selectAll()
      .where("flow_id", "in", flowIds)
      .orderBy("flow_id", "asc")
      .orderBy("step_order", "asc")
      .execute();
  }

  const stepsByFlow: Record<number, any[]> = {};
  for (const s of steps) {
    stepsByFlow[s.flow_id] = stepsByFlow[s.flow_id] ?? [];
    stepsByFlow[s.flow_id].push(s);
  }

  const data = flows.map((f: any) => ({ ...f, steps: stepsByFlow[f.id] ?? [] }));

  return reply.send({ status: 1, data });
};

// ── POST /auth/chatbot/flows ─────────────────────────────
// Create a new flow (with optional inline steps)
export const createFlow = async (
  req: FastifyRequest<{
    Body: {
      flow_name:         string;
      trigger_keywords?: string;
      trigger_type?:     string;
      trigger_channels?: string;
      is_default?:       boolean;
      is_active?:        boolean;
      steps?:            Array<{ step_order: number; step_type: string; message?: string; variable_name?: string; options_json?: string }>;
    };
  }>,
  reply: FastifyReply,
) => {
  const { uuid, username } = req.user as any;
  const { flow_name, trigger_keywords, trigger_type, trigger_channels, is_default, is_active, steps } = req.body ?? {};

  if (!flow_name?.trim()) {
    return reply.status(400).send({ status: 0, message: "flow_name is required" });
  }

  // If setting as default, remove default flag from others
  if (is_default) {
    await (db as any)
      .updateTable("chatbot_flows")
      .set({ is_default: 0 })
      .where("uuid", "=", uuid)
      .execute();
  }

  const result: any = await (db as any)
    .insertInto("chatbot_flows")
    .values({
      uuid,
      username,
      flow_name:        flow_name.trim(),
      trigger_keywords: trigger_keywords?.trim() ?? null,
      trigger_type:     trigger_type ?? "keyword",
      trigger_channels: trigger_channels?.trim() ?? null,
      is_default:       is_default ? 1 : 0,
      is_active:        is_active !== false ? 1 : 0,
      created_at:       new Date(),
      updated_at:       new Date(),
    })
    .execute();

  const flowId = Number(result.insertId);

  // Insert steps if provided
  if (steps?.length) {
    for (const step of steps) {
      await (db as any)
        .insertInto("chatbot_flow_steps")
        .values({
          flow_id:       flowId,
          uuid,
          step_order:    step.step_order ?? 0,
          step_type:     step.step_type  ?? "message",
          message:       step.message    ?? "",
          variable_name: step.variable_name ?? null,
          options_json:  step.options_json  ?? null,
          created_at:    new Date(),
          updated_at:    new Date(),
        })
        .execute();
    }
  }

  return reply.status(201).send({ status: 1, message: "Flow created", data: { id: flowId } });
};

// ── PUT /auth/chatbot/flows/:id ──────────────────────────
// Update flow metadata
export const updateFlow = async (
  req: FastifyRequest<{
    Params: { id: string };
    Body: { flow_name?: string; trigger_keywords?: string; trigger_type?: string; trigger_channels?: string; is_default?: boolean; is_active?: boolean };
  }>,
  reply: FastifyReply,
) => {
  const { uuid } = req.user as any;
  const flowId   = Number(req.params.id);
  const { flow_name, trigger_keywords, trigger_type, trigger_channels, is_default, is_active } = req.body ?? {};

  const existing: any = await (db as any)
    .selectFrom("chatbot_flows")
    .select(["id"])
    .where("id",   "=", flowId)
    .where("uuid", "=", uuid)
    .executeTakeFirst();

  if (!existing) return reply.status(404).send({ status: 0, message: "Flow not found" });

  if (is_default) {
    await (db as any)
      .updateTable("chatbot_flows")
      .set({ is_default: 0 })
      .where("uuid", "=", uuid)
      .execute();
  }

  const updates: Record<string, any> = { updated_at: new Date() };
  if (flow_name        !== undefined) updates.flow_name        = flow_name.trim();
  if (trigger_keywords !== undefined) updates.trigger_keywords = trigger_keywords?.trim() ?? null;
  if (trigger_type     !== undefined) updates.trigger_type     = trigger_type;
  if (trigger_channels !== undefined) updates.trigger_channels = trigger_channels?.trim() ?? null;
  if (is_default       !== undefined) updates.is_default       = is_default ? 1 : 0;
  if (is_active        !== undefined) updates.is_active        = is_active  ? 1 : 0;

  await (db as any).updateTable("chatbot_flows").set(updates).where("id", "=", flowId).execute();

  return reply.send({ status: 1, message: "Flow updated" });
};

// ── DELETE /auth/chatbot/flows/:id ───────────────────────
// Delete flow and all its steps
export const deleteFlow = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const { uuid } = req.user as any;
  const flowId   = Number(req.params.id);

  const existing: any = await (db as any)
    .selectFrom("chatbot_flows")
    .select(["id"])
    .where("id",   "=", flowId)
    .where("uuid", "=", uuid)
    .executeTakeFirst();

  if (!existing) return reply.status(404).send({ status: 0, message: "Flow not found" });

  await (db as any).deleteFrom("chatbot_flow_steps").where("flow_id", "=", flowId).execute();
  await (db as any).deleteFrom("chatbot_flows").where("id", "=", flowId).execute();

  return reply.send({ status: 1, message: "Flow deleted" });
};

// ============================================================
// Steps CRUD
// ============================================================

// ── GET /auth/chatbot/flows/:id/steps ───────────────────
export const listSteps = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const { uuid } = req.user as any;
  const flowId   = Number(req.params.id);

  const flow: any = await (db as any)
    .selectFrom("chatbot_flows")
    .select(["id"])
    .where("id",   "=", flowId)
    .where("uuid", "=", uuid)
    .executeTakeFirst();

  if (!flow) return reply.status(404).send({ status: 0, message: "Flow not found" });

  const steps: any[] = await (db as any)
    .selectFrom("chatbot_flow_steps")
    .selectAll()
    .where("flow_id", "=", flowId)
    .orderBy("step_order", "asc")
    .execute();

  return reply.send({ status: 1, data: steps });
};

// ── POST /auth/chatbot/flows/:id/steps ───────────────────
// Add a step to a flow
export const addStep = async (
  req: FastifyRequest<{
    Params: { id: string };
    Body: { step_order?: number; step_type?: string; message?: string; variable_name?: string; options_json?: string };
  }>,
  reply: FastifyReply,
) => {
  const { uuid } = req.user as any;
  const flowId   = Number(req.params.id);
  const { step_order, step_type, message, variable_name, options_json } = req.body ?? {};

  const resolvedType = step_type ?? "message";
  // message is only required for types that send text
  const needsMessage = ["message", "question", "end"].includes(resolvedType);
  if (needsMessage && !message?.trim()) {
    return reply.status(400).send({ status: 0, message: "message is required for this step type" });
  }

  const flow: any = await (db as any)
    .selectFrom("chatbot_flows")
    .select(["id"])
    .where("id",   "=", flowId)
    .where("uuid", "=", uuid)
    .executeTakeFirst();

  if (!flow) return reply.status(404).send({ status: 0, message: "Flow not found" });

  // Auto-assign order if not provided
  let order = step_order;
  if (order === undefined || order === null) {
    const last: any = await (db as any)
      .selectFrom("chatbot_flow_steps")
      .select((eb: any) => [eb.fn.max("step_order").as("max_order")])
      .where("flow_id", "=", flowId)
      .executeTakeFirst();
    order = (last?.max_order ?? -1) + 1;
  }

  const result: any = await (db as any)
    .insertInto("chatbot_flow_steps")
    .values({
      flow_id:       flowId,
      uuid,
      step_order:    order,
      step_type:     resolvedType,
      message:       message?.trim() ?? "",
      variable_name: variable_name ?? null,
      options_json:  options_json  ?? null,
      created_at:    new Date(),
      updated_at:    new Date(),
    })
    .execute();

  return reply.status(201).send({ status: 1, message: "Step added", data: { id: Number(result.insertId) } });
};

// ── PUT /auth/chatbot/flows/:id/steps/:stepId ────────────
// Update a step
export const updateStep = async (
  req: FastifyRequest<{
    Params: { id: string; stepId: string };
    Body: { step_order?: number; step_type?: string; message?: string; variable_name?: string; options_json?: string };
  }>,
  reply: FastifyReply,
) => {
  const { uuid } = req.user as any;
  const flowId   = Number(req.params.id);
  const stepId   = Number(req.params.stepId);
  const body     = req.body ?? {};

  const step: any = await (db as any)
    .selectFrom("chatbot_flow_steps")
    .select(["id"])
    .where("id",      "=", stepId)
    .where("flow_id", "=", flowId)
    .where("uuid",    "=", uuid)
    .executeTakeFirst();

  if (!step) return reply.status(404).send({ status: 0, message: "Step not found" });

  const updates: Record<string, any> = { updated_at: new Date() };
  if (body.step_order    !== undefined) updates.step_order    = body.step_order;
  if (body.step_type     !== undefined) updates.step_type     = body.step_type;
  if (body.message       !== undefined) updates.message       = body.message.trim();
  if (body.variable_name !== undefined) updates.variable_name = body.variable_name ?? null;
  if (body.options_json  !== undefined) updates.options_json  = body.options_json  ?? null;

  await (db as any).updateTable("chatbot_flow_steps").set(updates).where("id", "=", stepId).execute();

  return reply.send({ status: 1, message: "Step updated" });
};

// ── DELETE /auth/chatbot/flows/:id/steps/:stepId ─────────
export const deleteStep = async (
  req: FastifyRequest<{ Params: { id: string; stepId: string } }>,
  reply: FastifyReply,
) => {
  const { uuid } = req.user as any;
  const flowId   = Number(req.params.id);
  const stepId   = Number(req.params.stepId);

  const step: any = await (db as any)
    .selectFrom("chatbot_flow_steps")
    .select(["id"])
    .where("id",      "=", stepId)
    .where("flow_id", "=", flowId)
    .where("uuid",    "=", uuid)
    .executeTakeFirst();

  if (!step) return reply.status(404).send({ status: 0, message: "Step not found" });

  await (db as any).deleteFrom("chatbot_flow_steps").where("id", "=", stepId).execute();

  return reply.send({ status: 1, message: "Step deleted" });
};

// ============================================================
// Sessions — read-only view
// ============================================================

// ── GET /auth/chatbot/sessions ───────────────────────────
// List recent chatbot sessions with collected data
export const listSessions = async (
  req: FastifyRequest<{ Querystring: { page?: string; limit?: string; status?: string } }>,
  reply: FastifyReply,
) => {
  const { uuid } = req.user as any;
  const page   = Math.max(1, Number(req.query.page  ?? 1));
  const limit  = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
  const offset = (page - 1) * limit;
  const status = req.query.status ?? null;

  let query = (db as any)
    .selectFrom("chatbot_sessions as s")
    .leftJoin("chatbot_flows as f", "f.id", "s.flow_id")
    .select([
      "s.id", "s.uuid", "s.sender_id", "s.conversation_id",
      "s.flow_id", "f.flow_name",
      "s.collected_data", "s.status",
      "s.created_at", "s.updated_at",
    ])
    .where("s.uuid", "=", uuid);

  if (status) query = query.where("s.status", "=", status);

  const [rows, totalRow] = await Promise.all([
    query.orderBy("s.updated_at", "desc").limit(limit).offset(offset).execute(),
    (db as any)
      .selectFrom("chatbot_sessions as s")
      .select((eb: any) => [eb.fn.count("s.id").as("total")])
      .where("s.uuid", "=", uuid)
      .$if(!!status, (q: any) => q.where("s.status", "=", status))
      .executeTakeFirst(),
  ]);

  const total = Number(totalRow?.total ?? 0);

  // Parse collected_data JSON strings
  const data = rows.map((r: any) => ({
    ...r,
    collected_data: r.collected_data
      ? (() => { try { return JSON.parse(r.collected_data); } catch { return r.collected_data; } })()
      : null,
  }));

  return reply.send({
    status: 1,
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};
