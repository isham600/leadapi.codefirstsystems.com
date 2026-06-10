import axios from "axios";
import { db } from "../models/db.js";
import { saveMessage, upsertSummary } from "./webhook-processor.js";

// ── Auth header helper ────────────────────────────────────
function buildAuthHeader(tokenType: string | null, token: string): string {
  return (tokenType ?? "bearer").toLowerCase() === "apikey"
    ? `ApiKey ${token}`
    : `Bearer ${token}`;
}

// ============================================================
// Send a text reply via WhatsApp API
// ============================================================
async function sendWhatsAppText(params: {
  uuid:           string;
  username:       string;
  conversationId: string;
  toNumber:       string;
  text:           string;
}): Promise<void> {
  const { uuid, username, conversationId, toNumber, text } = params;

  const account: any = await (db as any)
    .selectFrom("whatsapp_accounts")
    .select(["phone_number_id", "url", "access_token", "access_token_type"])
    .where("username", "=", username)
    .where("status",   "=", "active")
    .orderBy("created_at", "desc")
    .executeTakeFirst();

  if (!account?.access_token || !account?.phone_number_id) {
    console.warn(`[chatbot-engine] No active WhatsApp account for user=${username}`);
    return;
  }

  const authHeader = buildAuthHeader(account.access_token_type, account.access_token);
  const graphBase  = (account.url as string | null)?.replace(/\/$/, "") ?? "https://graph.facebook.com/v19.0";
  const bizNumber  = account.phone_number_id as string;

  const waPayload = {
    messaging_product: "whatsapp",
    recipient_type:    "individual",
    to:                toNumber,
    type:              "text",
    text:              { body: text, preview_url: false },
  };

  let wamid: string | null = null;
  try {
    const res = await axios.post<{ messages?: Array<{ id: string }> }>(
      `${graphBase}/${account.phone_number_id}/messages`,
      waPayload,
      { headers: { Authorization: authHeader, "Content-Type": "application/json" }, timeout: 15_000 },
    );
    wamid = res.data?.messages?.[0]?.id ?? null;
  } catch (err: any) {
    console.error(`[chatbot-engine] WhatsApp send failed:`, err?.response?.data ?? err?.message);
  }

  await saveMessage({
    uuid, username,
    channel:         "whatsapp",
    conversation_id: conversationId,
    message_id:      wamid,
    sender_id:       bizNumber,
    receiver_id:     toNumber,
    type:            "text",
    text,
    direction:       "outbound",
    status:          wamid ? "sent" : "failed",
  });

  await upsertSummary({
    uuid, username,
    conversation_id:   conversationId,
    channel:           "whatsapp",
    sender_id:         bizNumber,
    receiver_id:       toNumber,
    last_message:      text.slice(0, 200),
    last_message_type: "text",
    last_message_dir:  "outbound",
  });
}

// ============================================================
// Send a text reply via RCS API
// ============================================================
async function sendRcsText(params: {
  uuid:           string;
  username:       string;
  conversationId: string;
  toNumber:       string;
  text:           string;
}): Promise<void> {
  const { uuid, username, conversationId, toNumber, text } = params;

  const account: any = await (db as any)
    .selectFrom("rcs_accounts")
    .select(["agent_id", "api_key"])
    .where("username", "=", username)
    .where("status",   "=", "active")
    .orderBy("created_at", "desc")
    .executeTakeFirst();

  if (!account?.api_key) {
    console.warn(`[chatbot-engine] No active RCS account for user=${username}`);
    return;
  }

  const agentId  = account.agent_id as string;
  const phone    = toNumber.startsWith("+") ? toNumber : `+${toNumber}`;
  const msgId    = `rcs-bot-${uuid}-${Date.now()}`;
  const rbmBase  = "https://rcsbusinessmessaging.googleapis.com/v1";

  let sentMsgId: string | null = null;
  try {
    const res = await axios.post(
      `${rbmBase}/phones/${encodeURIComponent(phone)}/agentMessages?key=${account.api_key}`,
      { messageId: msgId, contentMessage: { text } },
      { headers: { "Content-Type": "application/json" }, timeout: 15_000 },
    );
    sentMsgId = (res.data as any)?.name?.split("/").pop() ?? msgId;
  } catch (err: any) {
    console.error(`[chatbot-engine] RCS send failed:`, err?.response?.data ?? err?.message);
  }

  await saveMessage({
    uuid, username,
    channel:         "rcs",
    conversation_id: conversationId,
    message_id:      sentMsgId,
    sender_id:       agentId,
    receiver_id:     toNumber,
    type:            "text",
    text,
    direction:       "outbound",
    status:          sentMsgId ? "sent" : "failed",
  });

  await upsertSummary({
    uuid, username,
    conversation_id:   conversationId,
    channel:           "rcs",
    sender_id:         agentId,
    receiver_id:       toNumber,
    last_message:      text.slice(0, 200),
    last_message_type: "text",
    last_message_dir:  "outbound",
  });
}

// ============================================================
// Send a text reply via Facebook Messenger API
// ============================================================
async function sendFacebookText(params: {
  uuid:           string;
  username:       string;
  conversationId: string;
  toNumber:       string;   // recipient PSID
  text:           string;
}): Promise<void> {
  const { uuid, username, conversationId, toNumber, text } = params;

  const account: any = await (db as any)
    .selectFrom("meta_accounts")
    .select(["page_id", "access_token", "access_token_type"])
    .where("username", "=", username)
    .where("status",   "=", "active")
    .orderBy("created_at", "desc")
    .executeTakeFirst();

  if (!account?.access_token || !account?.page_id) {
    console.warn(`[chatbot-engine] No active Facebook (Meta) integration for user=${username}`);
    return;
  }

  const pageId = account.page_id as string;
  const token  = account.access_token as string;
  const msgId  = `fb-bot-${uuid}-${Date.now()}`;

  let sentMsgId: string | null = null;
  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/messages`,
      { recipient: { id: toNumber }, message: { text }, messaging_type: "RESPONSE" },
      {
        headers: { "Content-Type": "application/json" },
        params:  { access_token: token },
        timeout: 15_000,
      },
    );
    sentMsgId = (res.data as any)?.message_id ?? msgId;
  } catch (err: any) {
    console.error(`[chatbot-engine] Facebook send failed:`, err?.response?.data ?? err?.message);
  }

  await saveMessage({
    uuid, username,
    channel:         "facebook",
    conversation_id: conversationId,
    message_id:      sentMsgId,
    sender_id:       pageId,
    receiver_id:     toNumber,
    type:            "text",
    text,
    direction:       "outbound",
    status:          sentMsgId ? "sent" : "failed",
  });

  await upsertSummary({
    uuid, username,
    conversation_id:   conversationId,
    channel:           "facebook",
    sender_id:         pageId,
    receiver_id:       toNumber,
    last_message:      text.slice(0, 200),
    last_message_type: "text",
    last_message_dir:  "outbound",
  });
}

// ============================================================
// Channel-aware dispatcher — routes to the correct send fn
// ============================================================
async function sendReply(channel: string, params: {
  uuid:           string;
  username:       string;
  conversationId: string;
  toNumber:       string;
  text:           string;
}): Promise<void> {
  if (channel === "rcs")      return sendRcsText(params);
  if (channel === "facebook") return sendFacebookText(params);
  return sendWhatsAppText(params);   // default: whatsapp / chatbot channel
}

// ============================================================
// Evaluate a condition expression against session collected data
// ============================================================
function evaluateCondition(opts: any, collectedData: Record<string, string>): boolean {
  if (!opts?.variable || !opts?.operator) return false;
  const actual = (collectedData[opts.variable] ?? "").toString().toLowerCase().trim();
  const expected = (opts.value ?? "").toString().toLowerCase().trim();

  switch (opts.operator) {
    case "equals":         return actual === expected;
    case "not_equals":     return actual !== expected;
    case "contains":       return actual.includes(expected);
    case "not_contains":   return !actual.includes(expected);
    case "starts_with":    return actual.startsWith(expected);
    case "ends_with":      return actual.endsWith(expected);
    case "gt":             return parseFloat(actual) > parseFloat(expected);
    case "lt":             return parseFloat(actual) < parseFloat(expected);
    case "is_empty":       return actual === "";
    case "is_not_empty":   return actual !== "";
    default:               return false;
  }
}

// ============================================================
// Execute steps starting from a given step_order in a flow.
//
// Supported step types:
//   message          — send text & continue
//   question         — send text & wait for user reply
//   end              — optional send + close session
//   condition        — branch based on collected_data variable
//   delay            — wait N seconds before continuing
//   transfer_to_agent — mark conversation as needs_agent, stop bot
//   set_field        — update a lead DB field
//   webhook          — POST to external URL
// ============================================================
async function runStepsFrom(params: {
  uuid:           string;
  username:       string;
  channel:        string;
  conversationId: string;
  senderId:       string;
  flowId:         number;
  fromOrder:      number;
  sessionId:      number;
}): Promise<void> {
  const { uuid, username, channel, conversationId, senderId, flowId, fromOrder, sessionId } = params;

  const steps: any[] = await (db as any)
    .selectFrom("chatbot_flow_steps")
    .selectAll()
    .where("flow_id",    "=", flowId)
    .where("step_order", ">=", fromOrder)
    .orderBy("step_order", "asc")
    .execute();

  for (const step of steps) {
    // Parse options_json once per step
    let opts: Record<string, any> = {};
    try {
      if (step.options_json) opts = JSON.parse(step.options_json as string);
    } catch { /* malformed JSON — use empty */ }

    // ── end ──────────────────────────────────────────────────
    if (step.step_type === "end") {
      if (step.message?.trim()) {
        await sendReply(channel, { uuid, username, conversationId, toNumber: senderId, text: step.message });
      }
      await (db as any)
        .updateTable("chatbot_sessions")
        .set({ current_step_id: step.id, waiting_for_input: 0, status: "completed", updated_at: new Date() })
        .where("id", "=", sessionId)
        .execute();
      return;
    }

    // ── message ───────────────────────────────────────────────
    if (step.step_type === "message") {
      await sendReply(channel, { uuid, username, conversationId, toNumber: senderId, text: step.message });
      await (db as any)
        .updateTable("chatbot_sessions")
        .set({ current_step_id: step.id, waiting_for_input: 0, updated_at: new Date() })
        .where("id", "=", sessionId)
        .execute();
      continue;
    }

    // ── question ──────────────────────────────────────────────
    if (step.step_type === "question") {
      await sendReply(channel, { uuid, username, conversationId, toNumber: senderId, text: step.message });
      await (db as any)
        .updateTable("chatbot_sessions")
        .set({ current_step_id: step.id, waiting_for_input: 1, status: "active", updated_at: new Date() })
        .where("id", "=", sessionId)
        .execute();
      return;
    }

    // ── condition ─────────────────────────────────────────────
    if (step.step_type === "condition") {
      const session: any = await (db as any)
        .selectFrom("chatbot_sessions")
        .select(["collected_data"])
        .where("id", "=", sessionId)
        .executeTakeFirst();

      const collected: Record<string, string> = session?.collected_data
        ? JSON.parse(session.collected_data as string)
        : {};

      const result    = evaluateCondition(opts, collected);
      const nextOrder = result
        ? (opts.true_next_order  ?? step.step_order + 1)
        : (opts.false_next_order ?? step.step_order + 1);

      await (db as any)
        .updateTable("chatbot_sessions")
        .set({ current_step_id: step.id, waiting_for_input: 0, updated_at: new Date() })
        .where("id", "=", sessionId)
        .execute();

      // Recurse from the branched step_order
      await runStepsFrom({ ...params, fromOrder: nextOrder });
      return;
    }

    // ── delay ─────────────────────────────────────────────────
    if (step.step_type === "delay") {
      const seconds = Math.min(Number(opts.seconds ?? 5), 30); // cap at 30 s in-process
      await new Promise((r) => setTimeout(r, seconds * 1_000));
      await (db as any)
        .updateTable("chatbot_sessions")
        .set({ current_step_id: step.id, waiting_for_input: 0, updated_at: new Date() })
        .where("id", "=", sessionId)
        .execute();
      continue;
    }

    // ── transfer_to_agent ─────────────────────────────────────
    if (step.step_type === "transfer_to_agent") {
      if (step.message?.trim()) {
        await sendReply(channel, { uuid, username, conversationId, toNumber: senderId, text: step.message });
      }
      // Mark session as handed off
      await (db as any)
        .updateTable("chatbot_sessions")
        .set({ current_step_id: step.id, waiting_for_input: 0, status: "completed", updated_at: new Date() })
        .where("id", "=", sessionId)
        .execute();
      // Flag the conversation for agent pickup
      await (db as any)
        .updateTable("chat_summaries")
        .set({ needs_agent: 1, updated_at: new Date() })
        .where("conversation_id", "=", conversationId)
        .execute().catch(() => {});
      return;
    }

    // ── set_field ─────────────────────────────────────────────
    if (step.step_type === "set_field") {
      if (opts.field && opts.value !== undefined) {
        const allowed = ["status", "priority", "name", "email", "phone", "notes", "company", "assigned_to"];
        if (allowed.includes(opts.field)) {
          await (db as any)
            .updateTable("leads")
            .set({ [opts.field]: opts.value, updated_at: new Date() })
            .where((eb: any) => eb.or([
              eb("phone",    "=", senderId),
              eb("receiver_id", "=", senderId),
            ]))
            .where("username", "=", username)
            .execute().catch(() => {});
        }
      }
      await (db as any)
        .updateTable("chatbot_sessions")
        .set({ current_step_id: step.id, waiting_for_input: 0, updated_at: new Date() })
        .where("id", "=", sessionId)
        .execute();
      continue;
    }

    // ── webhook ───────────────────────────────────────────────
    if (step.step_type === "webhook") {
      if (opts.url) {
        const session: any = await (db as any)
          .selectFrom("chatbot_sessions")
          .select(["collected_data"])
          .where("id", "=", sessionId)
          .executeTakeFirst();

        const collected = session?.collected_data
          ? JSON.parse(session.collected_data as string)
          : {};

        await axios.post(opts.url, {
          uuid, username, channel, conversationId,
          sender_id: senderId,
          collected_data: collected,
        }, { timeout: 10_000 }).catch((err: any) =>
          console.error(`[chatbot-engine] webhook step failed: ${err?.message}`),
        );
      }
      await (db as any)
        .updateTable("chatbot_sessions")
        .set({ current_step_id: step.id, waiting_for_input: 0, updated_at: new Date() })
        .where("id", "=", sessionId)
        .execute();
      continue;
    }

    // ── Unknown step type — skip ──────────────────────────────
    console.warn(`[chatbot-engine] Unknown step type: ${step.step_type}`);
    await (db as any)
      .updateTable("chatbot_sessions")
      .set({ current_step_id: step.id, waiting_for_input: 0, updated_at: new Date() })
      .where("id", "=", sessionId)
      .execute();
  }

  await (db as any)
    .updateTable("chatbot_sessions")
    .set({ waiting_for_input: 0, status: "completed", updated_at: new Date() })
    .where("id", "=", sessionId)
    .execute();
}

// ============================================================
// Main entry point — called by the chatbot worker
// ============================================================
export async function processChatbotMessage(params: {
  uuid:           string;
  username:       string;
  channel:        string;
  conversationId: string;
  senderId:       string;
  text:           string | null;
}): Promise<void> {
  const { uuid, username, channel, conversationId, senderId, text } = params;
  const normalizedText = (text ?? "").trim().toLowerCase();

  // ── 1. Check for active session ───────────────────────────
  const session: any = await (db as any)
    .selectFrom("chatbot_sessions")
    .selectAll()
    .where("uuid",      "=", uuid)
    .where("sender_id", "=", senderId)
    .where("status",    "=", "active")
    .executeTakeFirst();

  if (session) {
    if (session.waiting_for_input) {
      // ── 2a. User replied to a question ─────────────────────
      const questionStep: any = await (db as any)
        .selectFrom("chatbot_flow_steps")
        .select(["id", "flow_id", "step_order", "variable_name"])
        .where("id", "=", session.current_step_id)
        .executeTakeFirst();

      if (questionStep?.variable_name && text?.trim()) {
        const collected = session.collected_data
          ? JSON.parse(session.collected_data as string)
          : {};
        collected[questionStep.variable_name] = text.trim();
        await (db as any)
          .updateTable("chatbot_sessions")
          .set({ collected_data: JSON.stringify(collected), updated_at: new Date() })
          .where("id", "=", session.id)
          .execute();
      }

      // Continue from the step AFTER the current question
      const nextOrder = (questionStep?.step_order ?? 0) + 1;
      await runStepsFrom({
        uuid, username, channel, conversationId, senderId,
        flowId:    session.flow_id,
        fromOrder: nextOrder,
        sessionId: session.id,
      });
    } else {
      // ── 2b. Session active but not waiting — resume ─────────
      const currentStep: any = await (db as any)
        .selectFrom("chatbot_flow_steps")
        .select(["step_order"])
        .where("id", "=", session.current_step_id)
        .executeTakeFirst();

      const nextOrder = (currentStep?.step_order ?? 0) + 1;
      await runStepsFrom({
        uuid, username, channel, conversationId, senderId,
        flowId:    session.flow_id,
        fromOrder: nextOrder,
        sessionId: session.id,
      });
    }
    return;
  }

  // ── 3. No active session — check if this is the contact's first ever message
  const isFirstEver: boolean = await (async () => {
    try {
      const row: any = await (db as any)
        .selectFrom("chatbot_sessions")
        .select(["id"])
        .where("uuid",      "=", uuid)
        .where("sender_id", "=", senderId)
        .executeTakeFirst();
      return !row;   // no previous sessions at all → first contact
    } catch { return false; }
  })();

  // ── 4. No active session — match a flow ───────────────────
  const flows: any[] = await (db as any)
    .selectFrom("chatbot_flows")
    .selectAll()
    .where("uuid",      "=", uuid)
    .where("is_active", "=", 1)
    .execute();

  let matchedFlow: any = null;

  for (const flow of flows) {
    // Skip flows restricted to other channels
    if (flow.trigger_channels) {
      const allowedChannels = (flow.trigger_channels as string)
        .split(",").map((c: string) => c.trim().toLowerCase()).filter(Boolean);
      if (allowedChannels.length > 0 && !allowedChannels.includes(channel)) continue;
    }

    const triggerType = (flow.trigger_type as string | null) ?? "keyword";

    // always — triggers on every inbound message
    if (triggerType === "always") {
      matchedFlow = flow;
      break;
    }

    // first_message — triggers only on the very first contact
    if (triggerType === "first_message") {
      if (isFirstEver) {
        matchedFlow = flow;
        break;
      }
      continue;
    }

    // keyword (default) — match trigger_keywords against message text
    if (triggerType === "keyword") {
      if (flow.is_default || !flow.trigger_keywords) continue;
      const keywords = (flow.trigger_keywords as string)
        .split(",")
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean);
      if (keywords.some((kw: string) => kw === "*" || normalizedText.includes(kw))) {
        matchedFlow = flow;
        break;
      }
      continue;
    }

    // opt_out — matched externally by automation-executor, not by chatbot engine
    // postback — handled by checking normalizedText against trigger_keywords as postback payload
    if (triggerType === "postback") {
      if (!flow.trigger_keywords) continue;
      const keywords = (flow.trigger_keywords as string)
        .split(",").map((k: string) => k.trim().toLowerCase()).filter(Boolean);
      if (keywords.some((kw: string) => normalizedText === kw || normalizedText.includes(kw))) {
        matchedFlow = flow;
        break;
      }
      continue;
    }
  }

  // Fallback to default keyword flow
  if (!matchedFlow) {
    matchedFlow = flows.find((f: any) =>
      f.is_default === 1 &&
      ((f.trigger_type ?? "keyword") === "keyword")
    ) ?? null;
  }

  if (!matchedFlow) {
    console.log(`[chatbot-engine] No flow matched for user=${username} text="${text}"`);
    return;
  }

  // ── 4. Get first step of matched flow ─────────────────────
  const firstStep: any = await (db as any)
    .selectFrom("chatbot_flow_steps")
    .selectAll()
    .where("flow_id", "=", matchedFlow.id)
    .orderBy("step_order", "asc")
    .executeTakeFirst();

  if (!firstStep) {
    console.log(`[chatbot-engine] Flow id=${matchedFlow.id} has no steps`);
    return;
  }

  // ── 5. Create or restart session ──────────────────────────
  const insertResult: any = await (db as any)
    .insertInto("chatbot_sessions")
    .values({
      uuid,
      username,
      conversation_id:  conversationId,
      sender_id:        senderId,
      flow_id:          matchedFlow.id,
      current_step_id:  null,
      waiting_for_input: 0,
      collected_data:   null,
      status:           "active",
      created_at:       new Date(),
      updated_at:       new Date(),
    })
    .onDuplicateKeyUpdate({
      flow_id:           matchedFlow.id,
      current_step_id:   null,
      waiting_for_input: 0,
      collected_data:    null,
      status:            "active",
      updated_at:        new Date(),
    })
    .execute();

  // Fetch the session id (insert or existing)
  const newSession: any = await (db as any)
    .selectFrom("chatbot_sessions")
    .select(["id"])
    .where("uuid",      "=", uuid)
    .where("sender_id", "=", senderId)
    .executeTakeFirst();

  if (!newSession) return;

  // ── 6. Run from first step ─────────────────────────────────
  await runStepsFrom({
    uuid, username, channel, conversationId, senderId,
    flowId:    matchedFlow.id,
    fromOrder: firstStep.step_order,
    sessionId: newSession.id,
  });
}
