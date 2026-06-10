import axios from "axios";
import { db } from "../models/db.js";
import { addAutomationLog } from "../modules/users/utils/automationService.js";
import { notify } from "./notify.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesKeywords(text: string, keywordCsv: string | null): boolean {
  if (!keywordCsv) return false;
  const normalized = text.trim().toLowerCase();
  return keywordCsv
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((kw) => kw === "*" || normalized.includes(kw));
}

// ── Send WhatsApp text (best-effort, reuses account from DB) ──────────────────

async function sendWhatsAppText(username: string, toNumber: string, message: string): Promise<void> {
  const account: any = await (db as any)
    .selectFrom("whatsapp_accounts")
    .select(["phone_number_id", "url", "access_token", "access_token_type"])
    .where("username", "=", username)
    .where("status",   "=", "active")
    .orderBy("created_at", "desc")
    .executeTakeFirst();

  if (!account?.access_token) return;

  const tokenType   = (account.access_token_type ?? "bearer").toLowerCase();
  const authHeader  = tokenType === "apikey" ? `ApiKey ${account.access_token}` : `Bearer ${account.access_token}`;
  const graphBase   = (account.url as string | null)?.replace(/\/$/, "") ?? "https://graph.facebook.com/v19.0";

  await axios.post(
    `${graphBase}/${account.phone_number_id}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type:    "individual",
      to:                toNumber,
      type:              "text",
      text:              { body: message, preview_url: false },
    },
    { headers: { Authorization: authHeader, "Content-Type": "application/json" }, timeout: 15_000 },
  ).catch(() => {/* fire-and-forget */});
}

// ── Execute a single automation's actions against a lead / context ────────────

async function executeActions(
  automationId: number,
  automationName: string,
  username: string,
  uuid: string,
  actions: any[],
  context: {
    lead_id?:   number | null;
    phone?:     string | null;
    text?:      string | null;
    eventLabel: string;
  },
): Promise<void> {
  const { lead_id, phone, eventLabel } = context;

  for (const action of actions) {
    try {
      switch (action.type) {
        // ── Assign lead to a user ──────────────────────────────
        case "assign_user": {
          if (!lead_id || !action.assigned_to) break;
          await (db as any)
            .updateTable("leads")
            .set({ assigned_to: action.assigned_to, updated_at: new Date() })
            .where("id", "=", lead_id)
            .execute();
          break;
        }

        // ── Move lead to a pipeline stage ──────────────────────
        case "update_stage": {
          if (!lead_id || !action.stage_id) break;
          await (db as any)
            .updateTable("leads")
            .set({ stage_id: Number(action.stage_id), updated_at: new Date() })
            .where("id", "=", lead_id)
            .execute();
          break;
        }

        // ── Add a tag to the lead ──────────────────────────────
        case "add_tag": {
          if (!lead_id || !action.tag) break;
          const lead: any = await (db as any)
            .selectFrom("leads")
            .select(["tags"])
            .where("id", "=", lead_id)
            .executeTakeFirst();
          if (!lead) break;
          const existing: string[] = lead.tags
            ? JSON.parse(lead.tags as string)
            : [];
          if (!existing.includes(action.tag)) {
            existing.push(action.tag);
            await (db as any)
              .updateTable("leads")
              .set({ tags: JSON.stringify(existing), updated_at: new Date() })
              .where("id", "=", lead_id)
              .execute();
          }
          break;
        }

        // ── Update a lead field ────────────────────────────────
        case "update_field": {
          if (!lead_id || !action.field || action.value === undefined) break;
          const allowed = ["status", "priority", "name", "email", "phone", "notes", "company"];
          if (!allowed.includes(action.field)) break;
          await (db as any)
            .updateTable("leads")
            .set({ [action.field]: action.value, updated_at: new Date() })
            .where("id", "=", lead_id)
            .execute();
          break;
        }

        // ── Send WhatsApp text ─────────────────────────────────
        case "send_whatsapp": {
          const to = action.to || phone;
          if (!to || !action.message) break;
          await sendWhatsAppText(username, to, action.message);
          break;
        }

        // ── Send in-app notification ───────────────────────────
        case "send_notification": {
          await notify({
            username,
            uuid,
            type:        action.notification_type ?? "automation",
            title:       action.title ?? "Automation triggered",
            description: action.description ?? eventLabel,
            link:        action.link ?? "/inbox",
          }).catch(() => {});
          break;
        }

        // ── Unknown action type — skip ─────────────────────────
        default:
          console.warn(`[automation-executor] Unknown action type: ${action.type}`);
      }
    } catch (err: any) {
      console.error(`[automation-executor] Action ${action.type} failed:`, err?.message);
    }
  }

  // Log execution
  await addAutomationLog(db, {
    automation_id:   automationId,
    username,
    automation_name: automationName,
    event:           eventLabel,
    result:          "success",
  });

  // Increment runs + last_run
  await (db as any)
    .updateTable("automation_summary")
    .set({ runs: (db as any).raw("runs + 1"), last_run: new Date(), updated_at: new Date() })
    .where("id", "=", automationId)
    .execute().catch(() => {});
}

// ── Public entry points ───────────────────────────────────────────────────────

/**
 * Called by webhook workers when an inbound text message arrives.
 * Checks active automations with trigger_type='keyword' whose keyword_match
 * contains any word from the message text.
 */
export async function runKeywordAutomations(params: {
  uuid:     string;
  username: string;
  text:     string;
  phone?:   string;
  lead_id?: number | null;
}): Promise<void> {
  const { uuid, username, text, phone, lead_id } = params;
  if (!text?.trim()) return;

  try {
    const automations: any[] = await (db as any)
      .selectFrom("automation_summary")
      .selectAll()
      .where("username",     "=", username)
      .where("status",       "=", "active")
      .where("trigger_type", "=", "keyword")
      .execute();

    for (const auto of automations) {
      if (!matchesKeywords(text, auto.keyword_match)) continue;
      const actions = auto.actions_json ? JSON.parse(auto.actions_json as string) : [];
      if (!Array.isArray(actions) || actions.length === 0) continue;

      await executeActions(
        auto.id,
        auto.name,
        username,
        uuid,
        actions,
        { lead_id: lead_id ?? null, phone, text, eventLabel: `Keyword match: "${text.slice(0, 50)}"` },
      );
    }
  } catch (err: any) {
    console.error(`[automation-executor] runKeywordAutomations error:`, err?.message);
  }
}

/**
 * Called by webhook workers when a button_reply / list_reply arrives.
 * Checks active automations with trigger_type='button_reply'.
 * action.button_id can optionally constrain which button payload triggers it.
 */
export async function runButtonReplyAutomations(params: {
  uuid:      string;
  username:  string;
  buttonId:  string;
  buttonText: string;
  phone?:    string;
  lead_id?:  number | null;
}): Promise<void> {
  const { uuid, username, buttonId, buttonText, phone, lead_id } = params;

  try {
    const automations: any[] = await (db as any)
      .selectFrom("automation_summary")
      .selectAll()
      .where("username",     "=", username)
      .where("status",       "=", "active")
      .where("trigger_type", "=", "button_reply")
      .execute();

    for (const auto of automations) {
      const actions = auto.actions_json ? JSON.parse(auto.actions_json as string) : [];
      if (!Array.isArray(actions) || actions.length === 0) continue;

      // Optional: filter by keyword_match as button ID / title filter
      if (auto.keyword_match && !matchesKeywords(buttonId, auto.keyword_match) &&
          !matchesKeywords(buttonText, auto.keyword_match)) continue;

      await executeActions(
        auto.id,
        auto.name,
        username,
        uuid,
        actions,
        { lead_id: lead_id ?? null, phone, eventLabel: `Button reply: "${buttonText}"` },
      );
    }
  } catch (err: any) {
    console.error(`[automation-executor] runButtonReplyAutomations error:`, err?.message);
  }
}

/**
 * Called when the first message from a contact arrives (no prior conversation).
 */
export async function runFirstMessageAutomations(params: {
  uuid:    string;
  username: string;
  phone?:  string;
  lead_id?: number | null;
  channel: string;
}): Promise<void> {
  const { uuid, username, phone, lead_id, channel } = params;

  try {
    const automations: any[] = await (db as any)
      .selectFrom("automation_summary")
      .selectAll()
      .where("username",     "=", username)
      .where("status",       "=", "active")
      .where("trigger_type", "=", "first_message")
      .execute();

    for (const auto of automations) {
      const actions = auto.actions_json ? JSON.parse(auto.actions_json as string) : [];
      if (!Array.isArray(actions) || actions.length === 0) continue;

      await executeActions(
        auto.id,
        auto.name,
        username,
        uuid,
        actions,
        { lead_id: lead_id ?? null, phone, eventLabel: `First message via ${channel}` },
      );
    }
  } catch (err: any) {
    console.error(`[automation-executor] runFirstMessageAutomations error:`, err?.message);
  }
}

/**
 * Called when an opt-out / stop word is received.
 */
export async function runOptOutAutomations(params: {
  uuid:     string;
  username: string;
  phone?:   string;
  lead_id?: number | null;
  channel:  string;
}): Promise<void> {
  const { uuid, username, phone, lead_id, channel } = params;

  try {
    const automations: any[] = await (db as any)
      .selectFrom("automation_summary")
      .selectAll()
      .where("username",     "=", username)
      .where("status",       "=", "active")
      .where("trigger_type", "=", "opt_out")
      .execute();

    for (const auto of automations) {
      const actions = auto.actions_json ? JSON.parse(auto.actions_json as string) : [];
      if (!Array.isArray(actions) || actions.length === 0) continue;

      await executeActions(
        auto.id,
        auto.name,
        username,
        uuid,
        actions,
        { lead_id: lead_id ?? null, phone, eventLabel: `Opt-out via ${channel}` },
      );
    }
  } catch (err: any) {
    console.error(`[automation-executor] runOptOutAutomations error:`, err?.message);
  }
}

/**
 * Generic CRM event trigger — pass triggerType matching your automation_summary rows.
 * Used for: new_lead, stage_change, session_expiry, missed_call, etc.
 */
export async function runEventAutomations(params: {
  uuid:       string;
  username:   string;
  triggerType: string;
  eventLabel: string;
  phone?:     string;
  lead_id?:   number | null;
}): Promise<void> {
  const { uuid, username, triggerType, eventLabel, phone, lead_id } = params;

  try {
    const automations: any[] = await (db as any)
      .selectFrom("automation_summary")
      .selectAll()
      .where("username",     "=", username)
      .where("status",       "=", "active")
      .where("trigger_type", "=", triggerType)
      .execute();

    for (const auto of automations) {
      const actions = auto.actions_json ? JSON.parse(auto.actions_json as string) : [];
      if (!Array.isArray(actions) || actions.length === 0) continue;

      await executeActions(
        auto.id,
        auto.name,
        username,
        uuid,
        actions,
        { lead_id: lead_id ?? null, phone, eventLabel },
      );
    }
  } catch (err: any) {
    console.error(`[automation-executor] runEventAutomations(${triggerType}) error:`, err?.message);
  }
}
