import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../../../models/db.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { metaSyncQueue } from "../../../queues/meta-sync.queue.js";
import {
  upsertMetaLead,
  resolveTenantId,
  LEAD_FIELDS_FULL,
  LEAD_FIELDS_BASIC,
  CRM_FIELD_ALLOWLIST,
  sendMetaCapiLeadEvent,
} from "../services/meta-lead.service.js";

const META_AUTH_BASE = "https://www.facebook.com/v25.0/dialog/oauth";
const META_GRAPH_BASE = "https://graph.facebook.com/v25.0";

export type MetaOAuthCallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

export type MetaFormCreateBody = {
  form_name: string;
  fields: any[];
};

/**
 * ============================================================
 * 1️⃣ META OAUTH CONNECT
 * Route: GET /api/meta/connect
 * ============================================================
 */
export const metaConnect = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = req.user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    const appId = process.env.META_APP_ID;
    const redirectUri = process.env.META_REDIRECT_URI;
    console.log(appId,redirectUri)

    if (!appId || !redirectUri) {
      return reply.status(500).send({
        status: 0,
        statuscode: 500,
        message: "Meta OAuth is not configured",
        error: "meta_config_missing",
        data: null,
        validation: null,
      });
    }




    const scopes = [
      "pages_show_list",
      "pages_read_engagement",
      // "leads_retrieval",  // requires App Review — re-enable after approval
      // "ads_management",   // requires App Review — re-enable after approval
      "public_profile",
      "email",
    ].join(",");

    const state = encodeURIComponent(
      JSON.stringify({
        u: username,
        ts: Date.now(),
      })
    );

    const authUrl = `${META_AUTH_BASE}?client_id=${encodeURIComponent(
      appId
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&scope=${encodeURIComponent(
      scopes
    )}&state=${state}&auth_type=rerequest`;

    return reply.redirect(authUrl);
  } catch (error) {
    req.log.error(error, "Meta connect error");
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to start Meta OAuth flow",
      error: "meta_connect_error",
      data: null,
      validation: null,
    });
  }
};

/**
 * ============================================================
 * 2️⃣ META OAUTH CALLBACK
 * Route: GET /api/meta/callback
 * ============================================================
 */
export const metaCallback = async (
  req: FastifyRequest<{ Querystring: MetaOAuthCallbackQuery }>,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    const { code, error, error_description } = req.query;

    if (error || !code) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Meta OAuth failed",
        error: error || "meta_oauth_failed",
        data: { error_description },
        validation: null,
      });
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = process.env.META_REDIRECT_URI;
    console.log(appId,appSecret,redirectUri);
    

    if (!appId || !appSecret || !redirectUri) {
      return reply.status(500).send({
        status: 0,
        statuscode: 500,
        message: "Meta OAuth is not configured",
        error: "meta_config_missing",
        data: null,
        validation: null,
      });
    }

    // 1) Exchange code for short-lived access token
    const tokenRes = await fetch(
      `${META_GRAPH_BASE}/oauth/access_token` +
        `?client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code=${encodeURIComponent(code)}`,
      { method: "GET" }
    );

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      req.log.error({ body }, "Meta short-lived token error");
      return reply.status(502).send({
        status: 0,
        statuscode: 502,
        message: "Failed to exchange Meta OAuth code",
        error: "meta_token_exchange_failed",
        data: null,
        validation: null,
      });
    }

    const tokenJson: any = await tokenRes.json();
    const shortLivedToken: string | undefined = tokenJson.access_token;

    if (!shortLivedToken) {
      return reply.status(502).send({
        status: 0,
        statuscode: 502,
        message: "Meta access token missing",
        error: "meta_token_missing",
        data: null,
        validation: null,
      });
    }

    // 2) Convert to long-lived token
    const longTokenRes = await fetch(
      `${META_GRAPH_BASE}/oauth/access_token` +
        `?grant_type=fb_exchange_token` +
        `&client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`,
      { method: "GET" }
    );

    if (!longTokenRes.ok) {
      const body = await longTokenRes.text();
      req.log.error({ body }, "Meta long-lived token error");
      return reply.status(502).send({
        status: 0,
        statuscode: 502,
        message: "Failed to create long-lived Meta token",
        error: "meta_long_token_failed",
        data: null,
        validation: null,
      });
    }

    const longTokenJson: any = await longTokenRes.json();
    const accessToken: string | undefined = longTokenJson.access_token;

    if (!accessToken) {
      return reply.status(502).send({
        status: 0,
        statuscode: 502,
        message: "Meta long-lived token missing",
        error: "meta_long_token_missing",
        data: null,
        validation: null,
      });
    }

    // 3) Fetch pages list
    const pagesRes = await fetch(
      `${META_GRAPH_BASE}/me/accounts?access_token=${encodeURIComponent(
        accessToken
      )}`,
      { method: "GET" }
    );

    if (!pagesRes.ok) {
      const body = await pagesRes.text();
      req.log.error({ body }, "Meta fetch pages error");
      return reply.status(502).send({
        status: 0,
        statuscode: 502,
        message: "Failed to fetch Meta pages",
        error: "meta_pages_failed",
        data: null,
        validation: null,
      });
    }

    const pagesJson: any = await pagesRes.json();
    const firstPage = Array.isArray(pagesJson?.data)
      ? pagesJson.data[0]
      : null;

    if (!firstPage?.id) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "No Meta pages available for this account",
        error: "meta_no_pages",
        data: null,
        validation: null,
      });
    }

    const meta_page_id = String(firstPage.id);

    // 4) Persist token + page for this client (users table used as client table)
    await db
      .updateTable("users")
      .set({
      
        meta_access_token: accessToken,
       
        meta_page_id,
        updated_at: new Date(),
      })
      .where("username", "=", username)
      .execute();

    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Meta account connected successfully",
      error: null,
      data: {
        meta_page_id,
      },
      validation: null,
    });
  } catch (error) {
    (req as any).log?.error?.(error, "Meta callback error");
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Meta OAuth callback failed",
      error: "meta_callback_error",
      data: null,
      validation: null,
    });
  }
};

/**
 * ============================================================
 * 3️⃣ META FORM CREATE
 * Route: POST /api/meta/forms     orignal api 
 * ============================================================
 */
// export const createMetaForm = async (
//   req: FastifyRequest<{ Body: MetaFormCreateBody }>,
//   reply: FastifyReply
// ) => {
//   try {
//     const username = req.user?.username;

//     if (!username) {
//       return reply.status(401).send({
//         status: 0,
//         statuscode: 401,
//         message: "Unauthorized",
//         error: "unauthorized",
//         data: null,
//         validation: null,
//       });
//     }

//     const { form_name, fields } = req.body || {};

//     if (!form_name || !Array.isArray(fields)) {
//       return reply.status(400).send({
//         status: 0,
//         statuscode: 400,
//         message: "Invalid payload",
//         error: "invalid_payload",
//         data: null,
//         validation: null,
//       });
//     }

//     // Fetch Meta page + token for this client
//     const user = await db
//       .selectFrom("users")
//       .select(["username", "tenant_id", "meta_page_id", "meta_access_token"] as any)
//       .where("username", "=", username)
//       .executeTakeFirst();

//     // @ts-expect-error dynamic columns
//     const meta_page_id: string | undefined = user?.meta_page_id ;
//     // @ts-expect-error dynamic columns
//     const meta_access_token: string | undefined = user?.meta_access_token;
 
//     if (!meta_page_id || !meta_access_token) {
//       return reply.status(400).send({
//         status: 0,
//         statuscode: 400,
//         message: "Meta page is not connected for this client",
//         error: "meta_page_not_connected",
//         data: null,
//         validation: null,
//       });
//     }


//     // Call Meta Graph API to create the lead form
//     const params = new URLSearchParams();
//     params.set("name", form_name);
//     params.set("access_token", meta_access_token);
//     params.set("questions", JSON.stringify(fields));

//     const createRes = await fetch(
//       `${META_GRAPH_BASE}/${encodeURIComponent(meta_page_id)}/leadgen_forms`,
//       {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/x-www-form-urlencoded",
//         },
//         body: params.toString(),
//       }
//     );

//     if (!createRes.ok) {
//       const body = await createRes.text();
//       req.log.error({ body }, "Meta form create error");
//       return reply.status(502).send({
//         status: 0,
//         statuscode: 502,
//         message: "Failed to create Meta lead form",
//         error: "meta_form_create_failed",
//         data: null,
//         validation: null,
//       });
//     }

//     const createJson: any = await createRes.json();
//     const meta_form_id: string | undefined = createJson.id;

//     if (!meta_form_id) {
//       return reply.status(502).send({
//         status: 0,
//         statuscode: 502,
//         message: "Meta form id missing",
//         error: "meta_form_id_missing",
//         data: null,
//         validation: null,
//       });
//     }

//     // Store in forms table (client_username + meta_form_id)
//     await db
//       .insertInto("forms")
//       .values({
        
//         client_username: username,
       
//         meta_form_id,
       
//         form_name,
        
//         created_at: new Date(),
//       })
//       .execute();

//     return reply.status(201).send({
//       status: 1,
//       statuscode: 201,
//       message: "Meta lead form created successfully",
//       error: null,
//       data: {
//         meta_form_id,
//       },
//       validation: null,
//     });
//   } catch (error) {
//     req.log.error(error, "Meta form create error");
//     return reply.status(500).send({
//       status: 0,
//       statuscode: 500,
//       message: "Failed to create Meta lead form",
//       error: "meta_form_error",
//       data: null,
//       validation: null,
//     });
//   }
// };



 

/**
 * ============================================================
 * 3️⃣ META FORM CREATE
 * Route: POST /api/meta/forms    with dummy data 
 * ============================================================
 */
export const createMetaForm = async (
  req: FastifyRequest<{ Body: MetaFormCreateBody }>,
  reply: FastifyReply
) => {
  try {
    const username = req.user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "unauthorized",
        data: null,
        validation: null,
      });
    }

    const { form_name } = req.body || {};

    if (!form_name) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Form name is required",
        error: "invalid_payload",
        data: null,
        validation: null,
      });
    }

    // ✅ Generate Dummy Meta Form ID
    const meta_form_id = `dummy_${Date.now()}`;

    // ✅ Insert into forms table
    await db
      .insertInto("forms")
      .values({
        client_username: username,
        meta_form_id,
        form_name,
        created_at: new Date(),
      })
      .execute();

    return reply.status(201).send({
      status: 1,
      statuscode: 201,
      message: "Dummy Meta lead form created successfully",
      error: null,
      data: {
        meta_form_id,
      },
      validation: null,
    });

  } catch (error) {
    req.log.error(error, "Meta form create error");
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to create Meta lead form",
      error: "meta_form_error",
      data: null,
      validation: null,
    });
  }
};
/**
 * ============================================================
 * 4️⃣ META WEBHOOK (VERIFY + LEAD CAPTURE)
 * Route: GET/POST /api/meta/webhook
 * ============================================================
 */
// export const metaWebhook = async (req: FastifyRequest, reply: FastifyReply) => {
//   // 4.1 Webhook verification (GET)
//   if (req.method === "GET") {
//     const query = req.query as Record<string, string | undefined>;
//     const mode = query["hub.mode"];
//     const token = query["hub.verify_token"];
//     const challenge = query["hub.challenge"];

//     const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;

//     if (mode === "subscribe" && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
//       return reply.status(200).send(challenge);
//     }

//     return reply.status(403).send("Verification failed");
//   }

//   // 4.2 Lead delivery (POST)
//   let client_username: string | null = null;
//   let meta_form_id: string | null = null;
//   let lead_payload: any = null;

//   try {
//     const payload = req.body as any;
//     lead_payload = payload;

//     const value = payload?.entry?.[0]?.changes?.[0]?.value;
//     const leadgen_id: string | undefined = value?.leadgen_id;
//     const form_id: string | undefined = value?.form_id;

//     if (!leadgen_id || !form_id) {
//       req.log.error(
//         { leadgen_id, form_id },
//         "Meta webhook missing leadgen_id or form_id"
//       );
//       // Always 200 to Meta
//       return reply.status(200).send({ received: false });
//     }

//     meta_form_id = String(form_id);

//     // Find form mapping → client_username
//     const formRow = await db
//       .selectFrom("forms")
     
//       .select(["client_username", "meta_form_id"])
   
//       .where("meta_form_id", "=", meta_form_id)
//       .executeTakeFirst();

//     if (!formRow?.client_username) {
//       req.log.error(
//         { meta_form_id },
//         "Meta webhook form not found for form_id"
//       );
//       return reply.status(200).send({ received: false });
//     }

//     client_username = formRow.client_username as string;

//     // Get Meta token + tenant for user
//     const user = await db
//       .selectFrom("users")
//       .select(["username", "tenant_id", "meta_access_token"] as any)
//       .where("username", "=", client_username)
//       .executeTakeFirst();

//     if (!user) {
//       req.log.error(
//         { client_username },
//         "Meta webhook user not found for client_username"
//       );
//       return reply.status(200).send({ received: false });
//     }

//     // @ts-expect-error dynamic columns
//     const meta_access_token: string | undefined = user.meta_access_token;

//     if (!meta_access_token) {
//       req.log.error(
//         { client_username },
//         "Meta webhook missing access token for user"
//       );
//       return reply.status(200).send({ received: false });
//     }

//     const tenant_id: string = (user as any).tenant_id;

//     // Fetch full lead from Meta Graph API
//     const leadRes = await fetch(
//       `${META_GRAPH_BASE}/${encodeURIComponent(
//         leadgen_id
//       )}?access_token=${encodeURIComponent(
//         meta_access_token
//       )}&fields=field_data,created_time`,
//       { method: "GET" }
//     );

//     if (!leadRes.ok) {
//       const body = await leadRes.text();
//       req.log.error({ body }, "Meta lead fetch error");
//       return reply.status(200).send({ received: false });
//     }

//     const leadJson: any = await leadRes.json();
//     const fieldData: any[] = Array.isArray(leadJson?.field_data)
//       ? leadJson.field_data
//       : [];

//     const getField = (names: string[]): string | null => {
//       for (const n of names) {
//         const found = fieldData.find(
//           (f) => String(f.name).toLowerCase() === n.toLowerCase()
//         );
//         if (found?.values?.[0]) return String(found.values[0]);
//       }
//       return null;
//     };

//     const full_name =
//       getField(["full_name", "name"]) ||
//       `${getField(["first_name"]) || ""} ${getField(["last_name"]) || ""}`.trim() ||
//       null;
//     const email = getField(["email", "email_address"]);
//     const phone =
//       getField(["phone_number", "phone", "mobile_phone"]) ||
//       null;

//     // Insert into leads table (aligned with existing schema)
//     await db
//       .insertInto("leads")
//       .values({
//         // core tenant + owner
      
//         tenant_id,
        
//         username: client_username,

//         // name/email/phone mapping
       
//         full_name: full_name,
      
//         first_name: full_name,
       
//         last_name: null,
      
//         email: email,
       
//         phone: phone,

//         // source metadata
        
//         source: "meta",
       
//         medium: "facebook_lead_ads",

//         // meta specific
        
//         meta_form_id: meta_form_id,
      
//         raw_payload: JSON.stringify(leadJson),

//         // lifecycle
        
//         status: "NEW",
       
//         lifecycle: "lead",

//         // timestamps
        
//         created_at: new Date(),
        
//         updated_at: new Date(),
//       })
//       .execute();

//     return reply.status(200).send({ received: true });
//   } catch (error) {
//     req.log.error(
//       { error, client_username, meta_form_id, lead_payload },
//       "Meta webhook processing error"
//     );
//     // Always 200 to Meta to avoid retries storm
//     return reply.status(200).send({ received: false });
//   }
// };






export function verifyMetaSignature(
  rawBody: string,
  signature: string | undefined,
  appSecret: string
): boolean {
  if (!rawBody || !signature) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

async function isDuplicateLead(params: {
  client_username: string;
  meta_form_id: string;
  leadgen_id: string;
}) {
  const existing = await db
    .selectFrom("leads")
    .select(["id"])
    .where("username", "=", params.client_username)
    .where("meta_form_id", "=", params.meta_form_id)
    .where("meta_lead_id", "=", params.leadgen_id)
    .executeTakeFirst();

  return !!existing;
}
/**
 * ============================================================
 * 4️⃣ META WEBHOOK (HYBRID: DUMMY + REAL)
 * Route: GET/POST /api/meta/webhook
 * ============================================================
 */
export const metaWebhook = async (req: FastifyRequest, reply: FastifyReply) => {
  /**
   * 4.1 WEBHOOK VERIFICATION (GET)
   */
  if (req.method === "GET") {
    const q = req.query as any;

    if (
      q["hub.mode"] === "subscribe" &&
      q["hub.verify_token"] === process.env.META_WEBHOOK_VERIFY_TOKEN
    ) {
      return reply.status(200).send(q["hub.challenge"]);
    }

    return reply.status(403).send("Verification failed");
  }

  /**
   * 4.2 SIGNATURE VERIFICATION
   */
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const rawBody = (req as any).rawBody as string;

  const isValid = verifyMetaSignature(
    rawBody,
    signature,
    process.env.META_APP_SECRET || "dummy_secret"
  );

  if (!isValid) {
    req.log.warn("Invalid Meta webhook signature");
    return reply.status(200).send({ received: false });
  }

  /**
   * 4.3 PROCESS WEBHOOK
   */
  try {
    const payload = req.body as any;
    const value = payload?.entry?.[0]?.changes?.[0]?.value;

    const leadgen_id: string | undefined = value?.leadgen_id;
    const form_id: string | undefined = value?.form_id;
    const page_id: string | undefined = value?.page_id;

    if (!form_id) {
      return reply.status(200).send({ received: false });
    }

    // 🔎 Find client — first try forms table, then fall back to meta_accounts by page_id
    let client_username: string | undefined;

    const formRow = await db
      .selectFrom("forms")
      .select(["client_username"])
      .where("meta_form_id", "=", String(form_id))
      .executeTakeFirst();

    if (formRow?.client_username) {
      client_username = formRow.client_username;
    } else if (page_id) {
      const acctRow = await db
        .selectFrom("meta_accounts")
        .select(["username"])
        .where("page_id", "=", String(page_id))
        .where("status", "=", "active")
        .executeTakeFirst();
      client_username = acctRow?.username;
    }

    if (!client_username) {
      req.log.warn({ form_id, page_id }, "Meta webhook: no client found for form/page");
      return reply.status(200).send({ received: false });
    }
    const IS_DUMMY = process.env.META_DUMMY_MODE === "true";

    /**
     * 4.4 DUPLICATE CHECK (only if leadgen_id exists)
     */
    if (leadgen_id) {
      const duplicate = await isDuplicateLead({
        client_username,
        meta_form_id: String(form_id),
        leadgen_id,
      });

      if (duplicate) {
        req.log.info({ leadgen_id }, "Duplicate lead ignored");
        return reply.status(200).send({ received: true, duplicate: true });
      }
    }

    /**
     * 4.5 DUMMY MODE
     */
    if (IS_DUMMY) {
      await db.insertInto("leads").values({
        tenant_id: "dummy_tenant",
        username: client_username,
        full_name: "Dummy Lead User",
        first_name: "Dummy",
        last_name: "User",
        email: "dummy@example.com",
        phone: "9999999999",
        source: "meta",
        medium: "lead_ads",
        meta_form_id: String(form_id),
        meta_lead_id: leadgen_id ?? null,
        raw_payload: JSON.stringify(payload),
        status: "NEW",
        lifecycle: "lead",
        created_at: new Date(),
        updated_at: new Date(),
      }).execute();

      return reply.status(200).send({ received: true, mode: "dummy" });
    }

    /**
     * 4.6 REAL MODE (Graph API)
     */
    if (!leadgen_id) {
      return reply.status(200).send({ received: false });
    }

    // Use meta_accounts token (page token) — more reliable than users.meta_access_token
    const acct = await getActiveAccount(client_username);
    // Canonical tenant key — users.uuid, same as the sync worker (P0-2 fix)
    const tenant_id = await resolveTenantId(client_username);

    if (!acct?.access_token) {
      return reply.status(200).send({ received: false });
    }

    // Exchange for page token if we have a page_id
    const access_token = acct.page_id
      ? await getPageToken(acct.access_token, acct.page_id)
      : acct.access_token;

    // Fetch the lead — FULL fields include campaign/adset/ad attribution but
    // need ads_read on the token; fall back to BASIC so capture never breaks
    let leadJson: any = null;
    for (const leadFields of [LEAD_FIELDS_FULL, LEAD_FIELDS_BASIC]) {
      const leadRes = await fetch(
        `${META_GRAPH_BASE}/${encodeURIComponent(leadgen_id)}?access_token=${encodeURIComponent(access_token)}&fields=${leadFields}`
      );
      const json: any = await leadRes.json().catch(() => null);
      if (json && !json.error) { leadJson = json; break; }
      req.log.warn({ leadgen_id, error: json?.error?.message }, "Meta lead fetch failed, retrying with basic fields");
    }

    if (!leadJson) {
      return reply.status(200).send({ received: false });
    }

    // Webhook payload carries ad_id even when the lead fetch couldn't
    leadJson.id    ??= leadgen_id;
    leadJson.ad_id ??= value?.ad_id;

    // Form name for sub_source (best effort, from cache)
    const formRowName: any = await (db as any)
      .selectFrom("meta_lead_forms_cache")
      .select(["name"])
      .where("form_id", "=", String(form_id))
      .where("username", "=", client_username)
      .executeTakeFirst()
      .catch(() => null);

    // Same normalization / dedup / scoring path as the sync worker (P0-3 fix)
    const result = await upsertMetaLead({
      username:   client_username,
      tenantId:   tenant_id,
      formId:     String(form_id),
      formName:   formRowName?.name ?? null,
      lead:       leadJson,
      rawPayload: JSON.stringify(leadJson),
    });

    return reply.status(200).send({ received: true, mode: "real", result });

  } catch (error) {
    req.log.error(error, "Meta webhook processing failed");
    return reply.status(200).send({ received: false });
  } finally {
    // optional: metrics / tracing / cleanup
  }
};





// import axios from "axios";

// const AD_ACCOUNT_ID = "123456789";
// const ACCESS_TOKEN = "EAABsbCS1...";

// const createCampaign = async () => {
//   const url = `https://graph.facebook.com/v24.0/act_${AD_ACCOUNT_ID}/campaigns`;

//   const response = await axios.post(url, null, {
//     params: {
//       name: "My First Lead Campaign",
//       objective: "LEAD_GENERATION",
//       status: "PAUSED",
//       access_token: ACCESS_TOKEN,
//     },
//   });

//   console.log(response.data);
// };

// createCampaign();

// ============================================================
// Shared scopes requested during Facebook OAuth
// ============================================================
const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "leads_retrieval",
  "pages_manage_ads",
].join(",");

// ============================================================
// 5️⃣  META OAUTH START
// Route: GET /api/meta/oauth/start
//
// Browser-facing redirect — never returns a body.
// The frontend triggers it with:  window.location.href = BACKEND_URL + "/api/meta/oauth/start?token=<access_token>"
//
// Why a query-param token?
//   The access_token cookie is set on the frontend domain (via the proxy).
//   When the browser navigates directly to the backend domain there is no
//   cookie to read, so the frontend must pass the JWT as ?token=.
//
// CSRF protection:
//   A random 48-char hex state is generated, stored in an httpOnly
//   "meta_oauth_state" cookie on the backend domain, and also sent to
//   Facebook in the OAuth URL.  The callback verifies both match.
//
// Username persistence:
//   The verified username is stored in a signed httpOnly
//   "meta_oauth_user" cookie so the callback knows who to save the
//   token for (no re-auth needed at callback time).
// ============================================================
export const metaOAuthStart = async (
  req: FastifyRequest<{ Querystring: { token?: string } }>,
  reply: FastifyReply
) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
  const isProduction = process.env.NODE_ENV === "production";

  // ── 1. Env guard ──────────────────────────────────────────
  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return reply.redirect(
      `${FRONTEND_URL}/integrations?meta_error=not_configured`
    );
  }

  // ── 2. JWT verification ────────────────────────────────────
  // Accept from ?token= query param (browser-redirect scenario where
  // the access_token cookie is on the frontend domain, not here).
  const rawToken = req.query.token;

  if (!rawToken) {
    return reply.redirect(
      `${FRONTEND_URL}/integrations?meta_error=unauthorized`
    );
  }

  let username: string;
  try {
    const decoded = jwt.verify(rawToken, process.env.JWT_SECRET!) as {
      username?: string;
      token_type?: string;
    };

    if (decoded.token_type !== "access" || !decoded.username) {
      return reply.redirect(
        `${FRONTEND_URL}/integrations?meta_error=unauthorized`
      );
    }

    username = decoded.username;
  } catch {
    return reply.redirect(
      `${FRONTEND_URL}/integrations?meta_error=unauthorized`
    );
  }

  // ── 3. Generate CSRF state ─────────────────────────────────
  const state = crypto.randomBytes(24).toString("hex"); // 48-char hex

  const csrfCookieOpts = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const, // lax: sent on top-level navigations (Facebook redirect back)
    maxAge: 30 * 60,          // 30 minutes
    path: "/",
  };

  // Store CSRF state on the backend domain
  reply.setCookie("meta_oauth_state", state, csrfCookieOpts);

  // Store username in a signed cookie so the callback can look it up
  reply.setCookie("meta_oauth_user", username, {
    ...csrfCookieOpts,
    signed: true, // Fastify signs with COOKIE_SECRET — prevents tampering
  });

  // ── 4. Build Facebook OAuth URL ────────────────────────────
  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  redirectUri,
    scope:         META_SCOPES,
    response_type: "code",
    state,
  });

  return reply.redirect(`${META_AUTH_BASE}?${params}`);
};

// ============================================================
// 6️⃣  META OAUTH CALLBACK
// Route: GET /api/meta/oauth/callback
//
// Receives the redirect from Facebook after the user approves.
// Does NOT require verifyJwt — the CSRF state cookie is the
// only authentication needed at this stage.
//
// Flow:
//   1. Verify CSRF state (cookie vs. URL param)
//   2. Recover username from signed meta_oauth_user cookie
//   3. Exchange auth code → short-lived token → long-lived token
//   4. Fetch the user's first Facebook Page
//   5. Persist access_token + page_id in the users table
//   6. Clear CSRF cookies and redirect to FRONTEND_URL/integrations
// ============================================================
export const metaOAuthCallback = async (
  req: FastifyRequest<{ Querystring: MetaOAuthCallbackQuery }>,
  reply: FastifyReply
) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

  // Helper: clear CSRF cookies on any exit path
  const clearCsrf = () => {
    reply.clearCookie("meta_oauth_state", { path: "/" });
    reply.clearCookie("meta_oauth_user",  { path: "/" });
  };

  const fail = (reason: string) => {
    clearCsrf();
    return reply.redirect(
      `${FRONTEND_URL}/integrations?meta_error=${encodeURIComponent(reason)}`
    );
  };

  // ── 1. Facebook error? ─────────────────────────────────────
  const { code, state, error } = req.query;

  if (error || !code) {
    return fail(error || "oauth_failed");
  }

  // ── 2. CSRF verification ───────────────────────────────────
  const storedState = req.cookies?.meta_oauth_state;

  if (!storedState || storedState !== state) {
    req.log.warn("Meta OAuth CSRF mismatch");
    return fail("csrf_failed");
  }

  // ── 3. Recover username from signed cookie ─────────────────
  const userCookieRaw = req.cookies?.meta_oauth_user;
  const { valid, value: username } = userCookieRaw
    ? req.unsignCookie(userCookieRaw)
    : { valid: false, value: null };

  if (!valid || !username) {
    return fail("session_expired");
  }

  // ── 4. Env vars ────────────────────────────────────────────
  const appId      = process.env.META_APP_ID;
  const appSecret  = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    return fail("not_configured");
  }

  try {
    // ── 5. Exchange code → short-lived user token ────────────
    const shortRes = await fetch(
      `${META_GRAPH_BASE}/oauth/access_token?` +
        `client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code=${encodeURIComponent(code)}`
    );

    if (!shortRes.ok) {
      req.log.error({ body: await shortRes.text() }, "Meta short-lived token error");
      return fail("token_exchange_failed");
    }

    const shortJson: any = await shortRes.json();
    const shortToken: string | undefined = shortJson.access_token;

    if (!shortToken) return fail("token_missing");

    // ── 6. Exchange → long-lived token (~60 days) ────────────
    const longRes = await fetch(
      `${META_GRAPH_BASE}/oauth/access_token?` +
        `grant_type=fb_exchange_token` +
        `&client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&fb_exchange_token=${encodeURIComponent(shortToken)}`
    );

    if (!longRes.ok) {
      req.log.error({ body: await longRes.text() }, "Meta long-lived token error");
      return fail("long_token_failed");
    }

    const longJson: any = await longRes.json();
    const accessToken: string | undefined = longJson.access_token;

    if (!accessToken) return fail("long_token_missing");

    // ── 7. Fetch user's first Facebook Page ──────────────────
    const pagesRes = await fetch(
      `${META_GRAPH_BASE}/me/accounts?access_token=${encodeURIComponent(accessToken)}`
    );

    if (!pagesRes.ok) {
      req.log.error({ body: await pagesRes.text() }, "Meta pages fetch error");
      return fail("pages_fetch_failed");
    }

    const pagesJson: any = await pagesRes.json();
    const firstPage = Array.isArray(pagesJson?.data) ? pagesJson.data[0] : null;

    if (!firstPage?.id) return fail("no_pages");

    const meta_page_id = String(firstPage.id);

    // ── 8. Persist to DB ──────────────────────────────────────
    await db
      .updateTable("users")
      .set({ meta_access_token: accessToken, meta_page_id, updated_at: new Date() })
      .where("username", "=", username)
      .execute();

    // ── 9. Clear CSRF cookies + redirect to success ──────────
    clearCsrf();
    return reply.redirect(`${FRONTEND_URL}/integrations?meta_success=1`);
  } catch (err) {
    req.log.error(err, "Meta OAuth callback error");
    return fail("server_error");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: get active meta account for a user
// ─────────────────────────────────────────────────────────────────────────────
async function getActiveAccount(username: string) {
  return (db as any)
    .selectFrom("meta_accounts")
    .selectAll()
    .where("username", "=", username)
    .where("status", "=", "active")
    .orderBy("id", "desc")
    .executeTakeFirst();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: exchange user access token → page access token
// Works transparently: if token is already a page token it's returned as-is
// ─────────────────────────────────────────────────────────────────────────────
async function getPageToken(userToken: string, pageId: string): Promise<string> {
  try {
    const res = await fetch(
      `${META_GRAPH_BASE}/${pageId}?fields=access_token&access_token=${userToken}`
    );
    const json: any = await res.json();
    return json.access_token ?? userToken;
  } catch {
    return userToken;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/page-info
// ─────────────────────────────────────────────────────────────────────────────
export const getPageInfo = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct) return reply.send({ status: 1, data: null });

  try {
    const pageToken = await getPageToken(acct.access_token, acct.page_id);
    const res = await fetch(
      `${META_GRAPH_BASE}/${acct.page_id}?fields=name,fan_count,link,category,picture&access_token=${pageToken}`
    );
    const json: any = await res.json();
    return reply.send({ status: 1, data: json.error ? null : json });
  } catch {
    return reply.send({ status: 1, data: null });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/instagram-info
// ─────────────────────────────────────────────────────────────────────────────
export const getInstagramInfo = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct) return reply.send({ status: 1, data: null });

  // Strategy 1: fetch via Facebook Page's linked Instagram Business Account
  // Works with page access token, no extra instagram_basic permission needed
  if (acct.page_id) {
    try {
      const pageToken = await getPageToken(acct.access_token, acct.page_id);
      const res = await fetch(
        `${META_GRAPH_BASE}/${acct.page_id}?fields=instagram_business_account{name,username,followers_count,media_count,profile_picture_url,biography,website}&access_token=${pageToken}`
      );
      const json: any = await res.json();
      const igData = json?.instagram_business_account;
      if (igData && !igData.error) {
        return reply.send({ status: 1, data: igData });
      }
    } catch { /* fall through to strategy 2 */ }
  }

  // Strategy 2: direct Instagram ID call
  if (acct.instagram_account_id) {
    try {
      const pageToken = acct.page_id
        ? await getPageToken(acct.access_token, acct.page_id)
        : acct.access_token;
      const res = await fetch(
        `${META_GRAPH_BASE}/${acct.instagram_account_id}?fields=name,username,followers_count,media_count,profile_picture_url,biography&access_token=${pageToken}`
      );
      const json: any = await res.json();
      if (!json.error) return reply.send({ status: 1, data: json });
    } catch { /* fall through */ }
  }

  return reply.send({ status: 1, data: null });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/lead-forms  — reads from local DB cache (populated by worker)
// ─────────────────────────────────────────────────────────────────────────────
export const getLeadForms = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const rows = await (db as any)
    .selectFrom("meta_lead_forms_cache")
    .select(["form_id as id", "name", "status", "leads_count", "created_time", "synced_at"])
    .where("username", "=", username)
    .orderBy("created_time", "desc")
    .execute();

  return reply.send({ status: 1, data: rows });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/lead-forms  — create a lead form on the page
// ─────────────────────────────────────────────────────────────────────────────
export const createLeadFormApi = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.page_id) return reply.status(400).send({ status: 0, message: "No Meta page connected" });

  const body = req.body as any;
  const {
    name,
    questions,
    privacy_policy_url,
    thank_you_message,
    // New fields from the wizard
    intro_headline,
    intro_description,
    form_type,
    thank_you_title,
    thank_you_description,
    cta_button_text,
    cta_button_url,
    custom_disclaimer,   // { title, body_text, checkboxes: [{ text, is_required }] }
  } = body;

  if (!name) return reply.status(400).send({ status: 0, message: "Form name is required" });

  // Meta requires a real, working privacy policy URL — never default to a fake one
  if (!privacy_policy_url || !/^https?:\/\/.+\..+/i.test(String(privacy_policy_url).trim())) {
    return reply.status(400).send({ status: 0, message: "A valid privacy_policy_url (https://…) is required" });
  }

  const thankYouTitle = thank_you_title ?? thank_you_message ?? "Thank you!";
  const thankYouBody  = thank_you_description ?? "We will get back to you soon.";

  const payload: any = {
    name,
    ...(form_type === "intent" ? { form_type: "HIGHER_INTENT" } : {}),
    questions: questions ?? [
      { type: "FULL_NAME" },
      { type: "EMAIL" },
      { type: "PHONE" },
    ],
    privacy_policy: { url: String(privacy_policy_url).trim() },
    thank_you_page: {
      title: thankYouTitle,
      body: thankYouBody,
      ...(cta_button_url ? { button_type: "VIEW_WEBSITE", website_url: cta_button_url, button_text: cta_button_text ?? "Visit Website" } : {}),
    },
    ...(intro_headline ? {
      context_card: {
        style: "LIST_STYLE",
        title: intro_headline,
        ...(intro_description ? { content: [intro_description] } : {}),
      },
    } : {}),
    // GDPR / consent: custom disclaimer with consent checkboxes
    ...(custom_disclaimer?.title || custom_disclaimer?.body_text || custom_disclaimer?.checkboxes?.length ? {
      custom_disclaimer: {
        ...(custom_disclaimer.title ? { title: custom_disclaimer.title } : {}),
        ...(custom_disclaimer.body_text ? { body: { text: custom_disclaimer.body_text } } : {}),
        ...(Array.isArray(custom_disclaimer.checkboxes) && custom_disclaimer.checkboxes.length ? {
          checkboxes: custom_disclaimer.checkboxes
            .filter((c: any) => c?.text?.trim())
            .map((c: any, i: number) => ({
              key:         `consent_${i + 1}`,
              text:        c.text.trim(),
              is_required: !!c.is_required,
              is_checked_by_default: false,
            })),
        } : {}),
      },
    } : {}),
  };

  try {
    const pageToken = await getPageToken(acct.access_token, acct.page_id);
    const res = await fetch(
      `${META_GRAPH_BASE}/${acct.page_id}/leadgen_forms?access_token=${pageToken}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message, data: json.error });
    return reply.send({ status: 1, message: "Lead form created", data: json });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to create lead form" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/lead-forms/:formId/leads  — fetch submitted leads for a form
// ─────────────────────────────────────────────────────────────────────────────
export const getFormLeads = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.page_id) return reply.status(400).send({ status: 0, message: "No Meta page connected" });

  const { formId } = req.params as { formId: string };
  if (!formId) return reply.status(400).send({ status: 0, message: "formId required" });

  // Cap how many leads we pull live from Graph in one request — uncapped
  // pagination times out and burns rate limits on large forms
  const q = req.query as any;
  const limit = Math.min(Math.max(Number(q?.limit) || 500, 1), 2000);

  try {
    const pageToken = await getPageToken(acct.access_token, acct.page_id);

    const allRaw: any[] = [];
    let hasMore = false;
    let url: string = `${META_GRAPH_BASE}/${formId}/leads?fields=id,created_time,field_data&access_token=${pageToken}&limit=100`;

    while (url && allRaw.length < limit) {
      const res = await fetch(url);
      const json: any = await res.json();
      if (json.error) return reply.status(400).send({ status: 0, message: json.error.message, data: json.error });
      allRaw.push(...(json.data ?? []));
      url = json.paging?.next ?? "";
      if (url && allRaw.length >= limit) hasMore = true;
    }
    const capped = allRaw.slice(0, limit);

    // Parse field_data into flat objects for easy display
    const leads = capped.map((lead: any) => {
      const fields: Record<string, string> = {};
      (lead.field_data ?? []).forEach((f: any) => {
        fields[f.name] = f.values?.[0] ?? "";
      });
      return { id: lead.id, created_time: lead.created_time, ...fields };
    });

    return reply.send({ status: 1, data: leads, total: leads.length, has_more: hasMore });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to fetch leads" });
  }
};

// Build the Insights time filter: custom since/until (time_range) when both
// are valid YYYY-MM-DD dates, otherwise the date_preset shorthand
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function insightsTimeParam(q: any): string {
  const { since, until, date_preset } = q ?? {};
  if (DATE_RE.test(since ?? "") && DATE_RE.test(until ?? "") && since <= until) {
    return `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  }
  return `date_preset=${encodeURIComponent(date_preset ?? "last_30d")}`;
}

// Range part of an insights cache key, e.g. "last_30d" or "2026-05-01_2026-05-15"
function insightsRangeKey(q: any): string {
  const { since, until, date_preset } = q ?? {};
  if (DATE_RE.test(since ?? "") && DATE_RE.test(until ?? "") && since <= until) return `${since}_${until}`;
  return String(date_preset ?? "last_30d");
}

// ── Insights cache: 15-min TTL per (account, endpoint, range) ────────────────
// Ad stats lag ~15–30 min on Meta's side anyway, so this costs no accuracy.
// Live fetch failures fall back to the stale cached copy.
const INSIGHTS_TTL_MS = 15 * 60 * 1000;

async function withInsightsCache<T>(
  acct: any,
  cacheKey: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; from_cache: boolean; stale?: boolean }> {
  const row: any = await (db as any)
    .selectFrom("meta_insights_cache")
    .select(["payload", "synced_at"])
    .where("account_id", "=", acct.id)
    .where("cache_key", "=", cacheKey)
    .executeTakeFirst()
    .catch(() => null);

  const isFresh = row && Date.now() - new Date(row.synced_at).getTime() < INSIGHTS_TTL_MS;
  if (isFresh) {
    try { return { data: JSON.parse(row.payload), from_cache: true }; } catch { /* corrupt — refetch */ }
  }

  try {
    const data = await fetcher();
    await (db as any)
      .insertInto("meta_insights_cache")
      .values({ account_id: acct.id, username: acct.username, cache_key: cacheKey, payload: JSON.stringify(data), synced_at: new Date() })
      .onDuplicateKeyUpdate({ payload: JSON.stringify(data), synced_at: new Date() })
      .execute()
      .catch(() => {});
    return { data, from_cache: false };
  } catch (err) {
    // Meta unreachable / errored — serve the stale copy if we have one
    if (row) {
      try { return { data: JSON.parse(row.payload), from_cache: true, stale: true }; } catch { /* ignore */ }
    }
    throw err;
  }
}

// GET /api/meta/insights  — ad account performance
// ─────────────────────────────────────────────────────────────────────────────
export const getInsights = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.send({ status: 1, data: null });

  try {
    const { data, from_cache, stale } = await withInsightsCache(acct, `insights:${insightsRangeKey(req.query)}`, async () => {
      const res = await fetch(
        `${META_GRAPH_BASE}/act_${acct.ad_account_id}/insights?fields=spend,impressions,clicks,reach,actions&${insightsTimeParam(req.query)}&access_token=${acct.access_token}`
      );
      const json: any = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data?.[0] ?? null;
    });
    return reply.send({ status: 1, data, from_cache, stale: stale ?? false });
  } catch (err: any) {
    return reply.send({ status: 1, data: null, error: err?.message ?? "Failed to fetch insights" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/campaigns
// ─────────────────────────────────────────────────────────────────────────────
export const getCampaigns = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const rows = await (db as any)
    .selectFrom("meta_campaigns_cache")
    .select([
      "campaign_id as id", "name", "status", "objective",
      "daily_budget", "lifetime_budget", "start_time", "stop_time",
      "spend", "impressions", "clicks", "reach", "leads", "created_time", "synced_at",
    ])
    .where("username", "=", username)
    .orderBy("created_time", "desc")
    .execute();

  return reply.send({ status: 1, data: rows });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/campaigns  — create campaign + ad set + creative + ad
// ─────────────────────────────────────────────────────────────────────────────
export const createCampaign = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.status(400).send({ status: 0, message: "No ad account linked" });

  const body = req.body as any;
  const {
    campaign_name, budget_type, budget_amount, bid_strategy,
    adset_name, lead_form_id, start_time, end_time,
    country, age_min, age_max,
    gender,            // "all" | "male" | "female"
    cities,            // [{ key, name }] from targeting-search (adgeolocation)
    interests,         // [{ id, name }]  from targeting-search (adinterest)
    headline, primary_text, description, cta_type,
    variant_headline, variant_primary_text,   // optional A/B creative variant
    publish,
  } = body;

  if (!campaign_name || !budget_amount || !lead_form_id) {
    return reply.status(400).send({ status: 0, message: "campaign_name, budget_amount and lead_form_id are required" });
  }

  // Ad-account mutations (campaign/adset/creative/ad) need the user token
  // with ads_management — page tokens are only for page-scoped endpoints
  const adsToken = acct.access_token;
  const campaignStatus = publish ? "ACTIVE" : "PAUSED";
  // Meta budget is in lowest currency unit (paise for INR, cents for USD)
  const budgetPaise = String(Math.round(Number(budget_amount) * 100));

  const { image_url, image_hash, video_id, carousel_cards } = body;

  try {
    // ── 1. Campaign ──────────────────────────────────────────────────────────
    // - buying_type: AUCTION required for OUTCOME_LEADS
    // - special_ad_categories: ["NONE"] for non-special ads ([] is invalid)
    // - is_adset_budget_sharing_enabled: false = ad-set level budget (not CBO)
    // - bid_strategy does NOT belong at campaign level (set at ad set level)
    const c1 = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name:                             campaign_name,
        objective:                        "OUTCOME_LEADS",
        buying_type:                      "AUCTION",
        status:                           campaignStatus,
        special_ad_categories:            JSON.stringify(["NONE"]),
        is_adset_budget_sharing_enabled:  "false",
        access_token:                     adsToken,
      }),
    });
    const campaign: any = await c1.json();
    if (campaign.error) return reply.status(400).send({ status: 0, message: campaign.error.message, meta_error: campaign.error });

    // ── 2. Ad Set ────────────────────────────────────────────────────────────
    // - destination_type: ON_AD = leads captured on the ad itself (not website)
    // - promoted_object: page_id required for lead gen
    // - bid_strategy at ad set level (not campaign)
    // - start_time: only if future; end_time: only if ≥ 25h from now for daily budget
    const nowMs = Date.now();
    const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;

    const startMs = start_time ? new Date(start_time).getTime() : nowMs;
    const isFutureStart = startMs > nowMs + 5 * 60 * 1000; // > 5 min from now

    // Targeting: country (or specific cities), age, gender, interests
    const targeting: any = {
      geo_locations: Array.isArray(cities) && cities.length > 0
        ? { cities: cities.map((c: any) => ({ key: String(c.key), radius: 25, distance_unit: "kilometer" })) }
        : { countries: [country ?? "IN"] },
      age_min: age_min ?? 18,
      age_max: age_max ?? 65,
    };
    if (gender === "male")   targeting.genders = [1];
    if (gender === "female") targeting.genders = [2];
    if (Array.isArray(interests) && interests.length > 0) {
      targeting.flexible_spec = [{ interests: interests.map((i: any) => ({ id: String(i.id), name: i.name })) }];
    }

    const adsetParams: any = {
      name:               adset_name ?? `${campaign_name} - Ad Set`,
      campaign_id:        campaign.id,
      optimization_goal:  "LEAD_GENERATION",
      billing_event:      "IMPRESSIONS",
      bid_strategy:       bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
      destination_type:   "ON_AD",
      promoted_object:    JSON.stringify({ page_id: acct.page_id }),
      status:             campaignStatus,
      targeting:          JSON.stringify(targeting),
      access_token: adsToken,
    };

    if (isFutureStart) adsetParams.start_time = String(Math.floor(startMs / 1000));

    if (budget_type === "lifetime") {
      if (!end_time) return reply.status(400).send({ status: 0, message: "end_time is required for lifetime budget" });
      const endMs = new Date(end_time).getTime();
      const effectiveStart = isFutureStart ? startMs : nowMs;
      if (endMs - effectiveStart < TWENTY_FIVE_HOURS_MS) {
        return reply.status(400).send({ status: 0, message: "Schedule must be at least 25 hours. Please extend the end date." });
      }
      adsetParams.lifetime_budget = budgetPaise;
      adsetParams.end_time = String(Math.floor(endMs / 1000));
    } else {
      adsetParams.daily_budget = budgetPaise;
      // For daily budget end_time is optional — only set if it's ≥ 25h from effective start
      if (end_time) {
        const endMs = new Date(end_time).getTime();
        const effectiveStart = isFutureStart ? startMs : nowMs;
        if (endMs - effectiveStart < TWENTY_FIVE_HOURS_MS) {
          return reply.status(400).send({ status: 0, message: "End date must be at least 25 hours from now. Please extend the end date or remove it." });
        }
        adsetParams.end_time = String(Math.floor(endMs / 1000));
      }
    }

    const c2 = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/adsets`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(adsetParams),
    });
    const adset: any = await c2.json();
    if (adset.error) return reply.status(400).send({ status: 0, message: adset.error.message, meta_error: adset.error });

    // ── 3. Ad Creative ───────────────────────────────────────────────────────
    // Three formats: single image (link_data), video (video_data with required
    // thumbnail), carousel (link_data + child_attachments, 2–10 cards)
    const callToAction = {
      type:  cta_type ?? "SIGN_UP",
      value: { lead_gen_form_id: lead_form_id },
    };

    const linkData: any = {
      message:     primary_text ?? campaign_name,
      name:        headline     ?? campaign_name,
      description: description  ?? "",
      link:        "http://fb.me/",   // required by Meta for lead gen link_data
      call_to_action: callToAction,
    };
    if (image_hash) linkData.image_hash = image_hash;
    else if (image_url) linkData.picture = image_url;

    let objectStorySpec: any;
    if (video_id) {
      // Video ad — Meta requires a thumbnail image alongside the video
      if (!image_hash && !image_url) {
        return reply.status(400).send({ status: 0, message: "A thumbnail image is required for video ads" });
      }
      objectStorySpec = {
        page_id: acct.page_id,
        video_data: {
          video_id:         String(video_id),
          message:          primary_text ?? campaign_name,
          title:            headline ?? campaign_name,
          link_description: description ?? "",
          ...(image_hash ? { image_hash } : { image_url }),
          call_to_action: callToAction,
        },
      };
    } else if (Array.isArray(carousel_cards) && carousel_cards.length >= 2) {
      objectStorySpec = {
        page_id: acct.page_id,
        link_data: {
          message: primary_text ?? campaign_name,
          link:    "http://fb.me/",
          call_to_action: callToAction,
          multi_share_optimized: true,
          child_attachments: carousel_cards.slice(0, 10).map((c: any) => ({
            link:        "http://fb.me/",
            name:        c.headline ?? headline ?? campaign_name,
            description: c.description ?? "",
            image_hash:  c.image_hash,
            call_to_action: callToAction,
          })),
        },
      };
    } else {
      objectStorySpec = { page_id: acct.page_id, link_data: linkData };
    }

    const c3 = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/adcreatives`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name:              `${campaign_name} - Creative`,
        object_story_spec: JSON.stringify(objectStorySpec),
        access_token:      adsToken,
      }),
    });
    const creative: any = await c3.json();
    if (creative.error) return reply.status(400).send({ status: 0, message: creative.error.message, meta_error: creative.error });

    // ── 4. Ad ────────────────────────────────────────────────────────────────
    const c4 = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/ads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name:         `${campaign_name} - Ad`,
        adset_id:     adset.id,
        creative:     JSON.stringify({ creative_id: creative.id }),
        status:       campaignStatus,
        access_token: adsToken,
      }),
    });
    const ad: any = await c4.json();
    if (ad.error) return reply.status(400).send({ status: 0, message: ad.error.message, meta_error: ad.error });

    // ── 5. Optional A/B variant: second creative + ad in the same ad set ────
    // Meta splits delivery between the ads and optimizes toward the winner.
    // Single-image format only — video/carousel variants aren't supported here.
    let variantAdId: string | null = null;
    const isSingleImage = !video_id && !(Array.isArray(carousel_cards) && carousel_cards.length >= 2);
    if (isSingleImage && (variant_headline?.trim() || variant_primary_text?.trim())) {
      const variantLinkData: any = {
        ...linkData,
        message: variant_primary_text?.trim() || linkData.message,
        name:    variant_headline?.trim()     || linkData.name,
      };
      const v1 = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/adcreatives`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          name:              `${campaign_name} - Creative B`,
          object_story_spec: JSON.stringify({ page_id: acct.page_id, link_data: variantLinkData }),
          access_token:      adsToken,
        }),
      });
      const creativeB: any = await v1.json();
      if (!creativeB.error) {
        const v2 = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/ads`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            name:         `${campaign_name} - Ad B`,
            adset_id:     adset.id,
            creative:     JSON.stringify({ creative_id: creativeB.id }),
            status:       campaignStatus,
            access_token: adsToken,
          }),
        });
        const adB: any = await v2.json();
        if (!adB.error) variantAdId = adB.id;
        else req.log.warn({ err: adB.error.message }, "A/B variant ad creation failed — campaign still created");
      } else {
        req.log.warn({ err: creativeB.error.message }, "A/B variant creative failed — campaign still created");
      }
    }

    return reply.send({
      status: 1,
      message: publish ? "Campaign published successfully" : "Campaign saved as draft",
      data: { campaign_id: campaign.id, adset_id: adset.id, creative_id: creative.id, ad_id: ad.id, variant_ad_id: variantAdId },
    });
  } catch (err: any) {
    return reply.status(500).send({ status: 0, message: err?.message ?? "Campaign creation failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/meta/campaigns/:id  — pause / resume
// ─────────────────────────────────────────────────────────────────────────────
export const updateCampaignStatus = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct) return reply.status(400).send({ status: 0, message: "No Meta account" });

  const { id } = req.params as any;
  const { status, name } = req.body as any;
  if (!status && !name) return reply.status(400).send({ status: 0, message: "Nothing to update" });

  // Campaign mutations need the user token (ads_management), not a page token
  const params = new URLSearchParams({ access_token: acct.access_token });
  if (status) params.set("status", status);
  if (name)   params.set("name", name);

  try {
    const res = await fetch(`${META_GRAPH_BASE}/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });

    // Keep the local cache in step so the UI reflects the change immediately
    const cacheUpdate: Record<string, any> = { synced_at: new Date() };
    if (status) cacheUpdate.status = status;
    if (name)   cacheUpdate.name = name;
    await (db as any)
      .updateTable("meta_campaigns_cache")
      .set(cacheUpdate)
      .where("username", "=", username)
      .where("campaign_id", "=", String(id))
      .execute()
      .catch(() => {});

    return reply.send({ status: 1, message: status ? `Campaign ${String(status).toLowerCase()}` : "Campaign updated" });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to update campaign" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/meta/campaigns/:id — delete campaign on Meta + remove from cache
// ─────────────────────────────────────────────────────────────────────────────
export const deleteCampaign = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct) return reply.status(400).send({ status: 0, message: "No Meta account" });

  const { id } = req.params as any;

  try {
    const res = await fetch(`${META_GRAPH_BASE}/${id}?access_token=${encodeURIComponent(acct.access_token)}`, {
      method: "DELETE",
    });
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });

    await (db as any)
      .deleteFrom("meta_campaigns_cache")
      .where("username", "=", username)
      .where("campaign_id", "=", String(id))
      .execute()
      .catch(() => {});

    return reply.send({ status: 1, message: "Campaign deleted" });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to delete campaign" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/account
// ─────────────────────────────────────────────────────────────────────────────
export const getMetaAccount = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const account = await (db as any)
    .selectFrom("meta_accounts")
    .select([
      "id", "page_id", "page_name", "ssid", "access_token_type",
      "ad_account_id", "business_id", "instagram_account_id", "pixel_id",
      "access_token",
      "status", "created_at", "updated_at",
    ])
    .where("username", "=", username)
    .where("status", "=", "active")
    .orderBy("id", "desc")
    .executeTakeFirst();

  if (!account) return reply.send({ status: 1, statuscode: 200, message: "OK", data: null });

  // Never echo the raw token to the browser — masked preview only
  const { access_token, ...safe } = account;
  const data = {
    ...safe,
    has_access_token: !!access_token,
    access_token_preview: access_token ? `••••••••${String(access_token).slice(-4)}` : null,
  };

  return reply.send({ status: 1, statuscode: 200, message: "OK", data });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/account  — manual entry (upsert)
// ─────────────────────────────────────────────────────────────────────────────
export const upsertMetaAccount = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const body = req.body as any;
  const { access_token, page_id, page_name, access_token_type, ssid,
          ad_account_id, business_id, instagram_account_id, pixel_id,
          new_account } = body;

  // new_account=true forces an INSERT (additional page/ad-account for this
  // client); the new row becomes the active one, others are deactivated
  const existing = new_account ? null : await (db as any)
    .selectFrom("meta_accounts")
    .select(["id"])
    .where("username", "=", username)
    .where("status", "=", "active")
    .orderBy("id", "desc")
    .executeTakeFirst();

  // Token required only on first save — updates keep the stored token
  // unless a new one is provided (so users never need to re-paste it)
  if (!access_token && !existing) {
    return reply.status(400).send({ status: 0, message: "access_token is required" });
  }

  if (existing) {
    await (db as any)
      .updateTable("meta_accounts")
      .set({
        ...(access_token ? { access_token } : {}),
        access_token_type: access_token_type ?? "page",
        page_id:            page_id            ?? null,
        page_name:          page_name          ?? null,
        ssid:               ssid               ?? null,
        ad_account_id:      ad_account_id      ?? null,
        business_id:        business_id        ?? null,
        instagram_account_id: instagram_account_id ?? null,
        pixel_id:           pixel_id           ?? null,
        status: "active",
        updated_at: new Date(),
      })
      .where("id", "=", existing.id)
      .execute();
  } else {
    const userRow: any = await (db as any)
      .selectFrom("users")
      .select(["uuid"])
      .where("username", "=", username)
      .executeTakeFirst();

    // Adding a new account: deactivate the others first (one active at a time)
    if (new_account) {
      await (db as any)
        .updateTable("meta_accounts")
        .set({ status: "inactive", updated_at: new Date() })
        .where("username", "=", username)
        .execute();
    }

    await (db as any)
      .insertInto("meta_accounts")
      .values({
        tenant_id:  userRow?.uuid ?? username,
        username,
        access_token,
        access_token_type: access_token_type ?? "page",
        page_id:            page_id            ?? null,
        page_name:          page_name          ?? null,
        ssid:               ssid               ?? null,
        ad_account_id:      ad_account_id      ?? null,
        business_id:        business_id        ?? null,
        instagram_account_id: instagram_account_id ?? null,
        pixel_id:           pixel_id           ?? null,
        app_id:             process.env.META_APP_ID             ?? null,
        app_secret:         process.env.META_APP_SECRET         ?? null,
        redirect_uri:       process.env.META_REDIRECT_URI       ?? null,
        webhook_verify_token: process.env.META_WEBHOOK_VERIFY_TOKEN ?? null,
        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
  }

  return reply.send({ status: 1, statuscode: 200, message: "Meta account saved successfully" });
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/meta/account
// ─────────────────────────────────────────────────────────────────────────────
export const deleteMetaAccount = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  await (db as any)
    .updateTable("meta_accounts")
    .set({ status: "inactive", updated_at: new Date() })
    .where("username", "=", username)
    .execute();

  return reply.send({ status: 1, statuscode: 200, message: "Meta account disconnected" });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/sync  — sync lead forms list + campaigns into DB cache
// ─────────────────────────────────────────────────────────────────────────────
export const syncMetaData = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.page_id) return reply.status(400).send({ status: 0, message: "No Meta page connected" });

  const datePreset = (req.body as any)?.date_preset ?? "last_30d";

  const job = await metaSyncQueue.add(
    `meta-sync-cache-${username}-${Date.now()}`,
    { username, accountId: acct.id, pageId: acct.page_id, adAccountId: acct.ad_account_id ?? null, accessToken: acct.access_token, syncType: "cache", datePreset },
    { priority: 1 }
  );

  return reply.status(202).send({ status: 1, message: "Cache sync queued — lead forms & campaigns will refresh in a few seconds", job_id: job.id });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/sync-leads  — pull all Meta form leads into the lead manager
// ─────────────────────────────────────────────────────────────────────────────
export const syncMetaLeads = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.page_id) return reply.status(400).send({ status: 0, message: "No Meta page connected" });

  const job = await metaSyncQueue.add(
    `meta-sync-leads-${username}-${Date.now()}`,
    { username, accountId: acct.id, pageId: acct.page_id, adAccountId: acct.ad_account_id ?? null, accessToken: acct.access_token, syncType: "leads" },
    { priority: 2 }
  );

  return reply.status(202).send({ status: 1, message: "Lead sync queued — leads will appear in Lead Manager shortly", job_id: job.id });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/sync-status/:jobId  — real job state for frontend polling
// ─────────────────────────────────────────────────────────────────────────────
export const getSyncStatus = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { jobId } = req.params as { jobId: string };
  const job = await metaSyncQueue.getJob(jobId);
  if (!job || job.data?.username !== username) {
    return reply.status(404).send({ status: 0, message: "Job not found" });
  }

  const state = await job.getState(); // waiting | active | completed | failed | delayed
  return reply.send({
    status: 1,
    data: {
      state,
      result: state === "completed" ? job.returnvalue : null,
      failed_reason: state === "failed" ? job.failedReason : null,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/ad-account-info  — name, currency, status from the ad account
// ─────────────────────────────────────────────────────────────────────────────
const AD_ACCOUNT_STATUS: Record<number, string> = {
  1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW",
  8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE",
  101: "CLOSED", 201: "ANY_ACTIVE", 202: "ANY_CLOSED",
};

export const getAdAccountInfo = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.send({ status: 1, data: null });

  try {
    const res = await fetch(
      `${META_GRAPH_BASE}/act_${acct.ad_account_id}?fields=name,currency,account_status,amount_spent,spend_cap,timezone_name&access_token=${acct.access_token}`
    );
    const json: any = await res.json();
    if (json.error) return reply.send({ status: 1, data: null, error: json.error.message });
    return reply.send({
      status: 1,
      data: {
        id:             acct.ad_account_id,
        name:           json.name ?? null,
        currency:       json.currency ?? null,
        account_status: AD_ACCOUNT_STATUS[json.account_status] ?? String(json.account_status ?? ""),
        amount_spent:   json.amount_spent ?? null,
        spend_cap:      json.spend_cap ?? null,
        timezone_name:  json.timezone_name ?? null,
      },
    });
  } catch {
    return reply.send({ status: 1, data: null, error: "Failed to fetch ad account info" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Profile cache — Overview data served from DB instead of hitting the Graph
// API on every visit. {page, instagram, ad_account, token_health} stored as
// JSON on the meta_accounts row; refreshed when stale or via POST /sync-profile.
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — profile data rarely changes

async function fetchFullProfile(acct: any): Promise<Record<string, any>> {
  const pageToken = acct.page_id ? await getPageToken(acct.access_token, acct.page_id) : acct.access_token;

  const [page, instagram, adAccount, tokenHealth] = await Promise.all([
    // Page info
    (async () => {
      if (!acct.page_id) return null;
      try {
        const r = await fetch(`${META_GRAPH_BASE}/${acct.page_id}?fields=name,fan_count,link,category,picture&access_token=${pageToken}`);
        const j: any = await r.json();
        return j.error ? null : j;
      } catch { return null; }
    })(),
    // Instagram (page-linked first, direct ID fallback)
    (async () => {
      if (acct.page_id) {
        try {
          const r = await fetch(`${META_GRAPH_BASE}/${acct.page_id}?fields=instagram_business_account{name,username,followers_count,media_count,profile_picture_url,biography,website}&access_token=${pageToken}`);
          const j: any = await r.json();
          if (j?.instagram_business_account && !j.instagram_business_account.error) return j.instagram_business_account;
        } catch { /* fall through */ }
      }
      if (acct.instagram_account_id) {
        try {
          const r = await fetch(`${META_GRAPH_BASE}/${acct.instagram_account_id}?fields=name,username,followers_count,media_count,profile_picture_url,biography&access_token=${pageToken}`);
          const j: any = await r.json();
          if (!j.error) return j;
        } catch { /* ignore */ }
      }
      return null;
    })(),
    // Ad account
    (async () => {
      if (!acct.ad_account_id) return null;
      try {
        const r = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}?fields=name,currency,account_status,amount_spent,spend_cap,timezone_name&access_token=${acct.access_token}`);
        const j: any = await r.json();
        if (j.error) return null;
        return {
          id: acct.ad_account_id,
          name: j.name ?? null,
          currency: j.currency ?? null,
          account_status: AD_ACCOUNT_STATUS[j.account_status] ?? String(j.account_status ?? ""),
          amount_spent: j.amount_spent ?? null,
          spend_cap: j.spend_cap ?? null,
          timezone_name: j.timezone_name ?? null,
        };
      } catch { return null; }
    })(),
    // Token health
    (async () => {
      const appId     = acct.app_id     ?? process.env.META_APP_ID;
      const appSecret = acct.app_secret ?? process.env.META_APP_SECRET;
      if (!appId || !appSecret) return null;
      try {
        const r = await fetch(`${META_GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(acct.access_token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`);
        const j: any = await r.json();
        const d = j?.data;
        if (!d) return null;
        const expiresAt = d.expires_at ? new Date(d.expires_at * 1000) : null;
        return {
          is_valid:   !!d.is_valid,
          expires_at: expiresAt,
          days_left:  expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000) : null,
          scopes:     d.scopes ?? [],
          type:       d.type ?? null,
        };
      } catch { return null; }
    })(),
  ]);

  return { page, instagram, ad_account: adAccount, token_health: tokenHealth };
}

async function refreshProfileCache(acct: any): Promise<{ profile: Record<string, any>; synced_at: Date }> {
  const profile = await fetchFullProfile(acct);
  const synced_at = new Date();
  await (db as any)
    .updateTable("meta_accounts")
    .set({ profile_cache: JSON.stringify(profile), profile_synced_at: synced_at })
    .where("id", "=", acct.id)
    .execute()
    .catch(() => {});
  return { profile, synced_at };
}

// GET /api/meta/profile — cache-first: DB → live fetch only when missing/stale
export const getProfile = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct) return reply.send({ status: 1, data: null });

  const syncedAt = acct.profile_synced_at ? new Date(acct.profile_synced_at) : null;
  const isFresh  = syncedAt && Date.now() - syncedAt.getTime() < PROFILE_TTL_MS;

  if (acct.profile_cache && isFresh) {
    try {
      return reply.send({
        status: 1,
        data: { ...JSON.parse(acct.profile_cache), synced_at: syncedAt, from_cache: true },
      });
    } catch { /* corrupt cache — fall through to live fetch */ }
  }

  // Missing or stale → fetch live and store; keep stale cache as fallback
  try {
    const { profile, synced_at } = await refreshProfileCache(acct);
    return reply.send({ status: 1, data: { ...profile, synced_at, from_cache: false } });
  } catch {
    if (acct.profile_cache) {
      try {
        return reply.send({ status: 1, data: { ...JSON.parse(acct.profile_cache), synced_at: syncedAt, from_cache: true, stale: true } });
      } catch { /* ignore */ }
    }
    return reply.send({ status: 1, data: null, error: "Failed to load profile" });
  }
};

// POST /api/meta/sync-profile — force refresh (the "Sync Profile" button)
export const syncProfile = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct) return reply.status(400).send({ status: 0, message: "No Meta account" });

  try {
    const { profile, synced_at } = await refreshProfileCache(acct);
    return reply.send({ status: 1, message: "Profile synced", data: { ...profile, synced_at, from_cache: false } });
  } catch {
    return reply.status(500).send({ status: 0, message: "Profile sync failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/lead-forms/:formId/questions — question keys for field mapping
// ─────────────────────────────────────────────────────────────────────────────
export const getFormQuestions = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.page_id) return reply.status(400).send({ status: 0, message: "No Meta page connected" });

  const { formId } = req.params as { formId: string };

  // Meta forms are immutable after creation — questions cache never expires
  const cached: any = await (db as any)
    .selectFrom("meta_lead_forms_cache")
    .select(["questions_cache"])
    .where("username", "=", username)
    .where("form_id", "=", String(formId))
    .executeTakeFirst()
    .catch(() => null);

  if (cached?.questions_cache) {
    try {
      return reply.send({ status: 1, data: JSON.parse(cached.questions_cache), from_cache: true });
    } catch { /* corrupt — refetch */ }
  }

  try {
    const pageToken = await getPageToken(acct.access_token, acct.page_id);
    const res = await fetch(
      `${META_GRAPH_BASE}/${encodeURIComponent(formId)}?fields=questions{key,label,type}&access_token=${pageToken}`
    );
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });

    const questions = (json.questions ?? []).map((q: any) => ({
      key:   String(q.key ?? "").toLowerCase(),
      label: q.label ?? q.key ?? "",
      type:  q.type ?? "CUSTOM",
    }));

    // Store for next time (best effort — row may not exist until first sync)
    await (db as any)
      .updateTable("meta_lead_forms_cache")
      .set({ questions_cache: JSON.stringify(questions) })
      .where("username", "=", username)
      .where("form_id", "=", String(formId))
      .execute()
      .catch(() => {});

    return reply.send({ status: 1, data: questions, from_cache: false });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to fetch form questions" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/lead-forms/:formId/field-map — current mapping
// PUT /api/meta/lead-forms/:formId/field-map — replace mapping
// ─────────────────────────────────────────────────────────────────────────────
export const getFieldMap = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { formId } = req.params as { formId: string };
  const rows = await (db as any)
    .selectFrom("meta_form_field_map")
    .select(["meta_field", "crm_field"])
    .where("username", "=", username)
    .where("form_id",  "=", String(formId))
    .execute();

  return reply.send({ status: 1, data: rows, allowed_fields: CRM_FIELD_ALLOWLIST });
};

export const saveFieldMap = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { formId } = req.params as { formId: string };
  const { mappings } = req.body as { mappings: Array<{ meta_field: string; crm_field: string }> };

  if (!Array.isArray(mappings)) {
    return reply.status(400).send({ status: 0, message: "mappings array required" });
  }

  const valid = mappings.filter(
    (m) => m?.meta_field?.trim() && (CRM_FIELD_ALLOWLIST as readonly string[]).includes(m?.crm_field)
  );

  // Replace-all semantics: simple and predictable for a per-form config
  await (db as any)
    .deleteFrom("meta_form_field_map")
    .where("username", "=", username)
    .where("form_id",  "=", String(formId))
    .execute();

  for (const m of valid) {
    await (db as any)
      .insertInto("meta_form_field_map")
      .values({
        username,
        form_id:    String(formId),
        meta_field: m.meta_field.trim().toLowerCase(),
        crm_field:  m.crm_field,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute()
      .catch(() => {}); // duplicate meta_field in payload — keep first
  }

  return reply.send({ status: 1, message: `Saved ${valid.length} field mapping${valid.length === 1 ? "" : "s"}` });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/token-health — debug_token: validity + expiry + scopes
// ─────────────────────────────────────────────────────────────────────────────
export const getTokenHealth = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.access_token) return reply.send({ status: 1, data: null });

  const appId     = acct.app_id     ?? process.env.META_APP_ID;
  const appSecret = acct.app_secret ?? process.env.META_APP_SECRET;
  if (!appId || !appSecret) return reply.send({ status: 1, data: null, error: "App credentials not configured" });

  try {
    const res = await fetch(
      `${META_GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(acct.access_token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`
    );
    const json: any = await res.json();
    const d = json?.data;
    if (!d) return reply.send({ status: 1, data: null, error: json?.error?.message ?? "debug_token failed" });

    const expiresAt = d.expires_at ? new Date(d.expires_at * 1000) : null; // 0 = never expires
    const daysLeft  = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000) : null;

    return reply.send({
      status: 1,
      data: {
        is_valid:   !!d.is_valid,
        expires_at: expiresAt,
        days_left:  daysLeft,           // null = never expires
        scopes:     d.scopes ?? [],
        type:       d.type ?? null,
      },
    });
  } catch {
    return reply.send({ status: 1, data: null, error: "Failed to check token" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/insights-timeseries — daily series for the analytics chart
// ─────────────────────────────────────────────────────────────────────────────
export const getInsightsTimeseries = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.send({ status: 1, data: [] });

  try {
    const { data, from_cache, stale } = await withInsightsCache(acct, `timeseries:${insightsRangeKey(req.query)}`, async () => {
      const res = await fetch(
        `${META_GRAPH_BASE}/act_${acct.ad_account_id}/insights?fields=spend,impressions,clicks,reach,cpm,frequency,actions&${insightsTimeParam(req.query)}&time_increment=1&limit=500&access_token=${acct.access_token}`
      );
      const json: any = await res.json();
      if (json.error) throw new Error(json.error.message);
      return (json.data ?? []).map((row: any) => ({
        date:        row.date_start,
        spend:       Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks:      Number(row.clicks ?? 0),
        reach:       Number(row.reach ?? 0),
        cpm:         Number(row.cpm ?? 0),
        frequency:   Number(row.frequency ?? 0),
        leads:       Number((row.actions ?? []).find((a: any) => a.action_type === "lead")?.value ?? 0),
      }));
    });
    return reply.send({ status: 1, data, from_cache, stale: stale ?? false });
  } catch (err: any) {
    return reply.send({ status: 1, data: [], error: err?.message ?? "Failed to fetch timeseries" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/insights-by-campaign — live campaign-level insights for any
// preset or custom since/until range (the sync cache is fixed at last_30d)
// ─────────────────────────────────────────────────────────────────────────────
export const getInsightsByCampaign = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.send({ status: 1, data: [] });

  try {
    const { data, from_cache, stale } = await withInsightsCache(acct, `bycampaign:${insightsRangeKey(req.query)}`, async () => {
      const res = await fetch(
        `${META_GRAPH_BASE}/act_${acct.ad_account_id}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,actions&level=campaign&${insightsTimeParam(req.query)}&limit=200&access_token=${acct.access_token}`
      );
      const json: any = await res.json();
      if (json.error) throw new Error(json.error.message);
      return (json.data ?? []).map((row: any) => ({
        id:          row.campaign_id,
        name:        row.campaign_name,
        spend:       Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks:      Number(row.clicks ?? 0),
        leads:       Number((row.actions ?? []).find((a: any) => a.action_type === "lead")?.value ?? 0),
      }));
    });
    return reply.send({ status: 1, data, from_cache, stale: stale ?? false });
  } catch (err: any) {
    return reply.send({ status: 1, data: [], error: err?.message ?? "Failed to fetch campaign insights" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/ad-images — upload creative image, returns image_hash
// ─────────────────────────────────────────────────────────────────────────────
export const uploadAdImage = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.status(400).send({ status: 0, message: "No ad account linked" });

  const { image_base64 } = req.body as { image_base64?: string };
  if (!image_base64) return reply.status(400).send({ status: 0, message: "image_base64 required" });
  // Strip data-URL prefix if present
  const b64 = image_base64.replace(/^data:image\/\w+;base64,/, "");
  if (b64.length > 11_000_000) return reply.status(400).send({ status: 0, message: "Image too large (max ~8MB)" });

  try {
    const res = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/adimages`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ bytes: b64, access_token: acct.access_token }),
    });
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });
    const img: any = Object.values(json.images ?? {})[0];
    if (!img?.hash) return reply.status(400).send({ status: 0, message: "Upload succeeded but no image hash returned" });
    return reply.send({ status: 1, data: { image_hash: img.hash, url: img.url ?? null } });
  } catch {
    return reply.status(500).send({ status: 0, message: "Image upload failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/ad-videos — upload creative video, returns video_id
// ─────────────────────────────────────────────────────────────────────────────
export const uploadAdVideo = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.status(400).send({ status: 0, message: "No ad account linked" });

  const { video_base64, filename } = req.body as { video_base64?: string; filename?: string };
  if (!video_base64) return reply.status(400).send({ status: 0, message: "video_base64 required" });
  const b64 = video_base64.replace(/^data:video\/\w+;base64,/, "");
  if (b64.length > 80_000_000) return reply.status(400).send({ status: 0, message: "Video too large (max ~55MB)" });

  try {
    const buf = Buffer.from(b64, "base64");
    const form = new FormData();
    form.append("access_token", acct.access_token);
    form.append("source", new Blob([buf], { type: "video/mp4" }), filename ?? "ad-video.mp4");

    const res = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/advideos`, {
      method: "POST",
      body: form as any,
    });
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });
    if (!json.id)   return reply.status(400).send({ status: 0, message: "Upload succeeded but no video id returned" });
    return reply.send({ status: 1, data: { video_id: json.id } });
  } catch (err: any) {
    return reply.status(500).send({ status: 0, message: err?.message ?? "Video upload failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/targeting-search?type=adinterest|adgeolocation&q=…
// ─────────────────────────────────────────────────────────────────────────────
export const targetingSearch = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.access_token) return reply.status(400).send({ status: 0, message: "No Meta account" });

  const { type, q } = req.query as { type?: string; q?: string };
  if (!q?.trim()) return reply.send({ status: 1, data: [] });
  const searchType = type === "adgeolocation" ? "adgeolocation" : "adinterest";

  try {
    const params = new URLSearchParams({
      type: searchType,
      q: q.trim(),
      limit: "10",
      access_token: acct.access_token,
    });
    if (searchType === "adgeolocation") params.set("location_types", JSON.stringify(["city"]));
    const res = await fetch(`${META_GRAPH_BASE}/search?${params}`);
    const json: any = await res.json();
    if (json.error) return reply.send({ status: 1, data: [], error: json.error.message });

    const data = (json.data ?? []).map((r: any) =>
      searchType === "adinterest"
        ? { id: r.id, name: r.name, audience_size: r.audience_size_upper_bound ?? null }
        : { key: r.key, name: r.name, region: r.region ?? null, country_name: r.country_name ?? null });
    return reply.send({ status: 1, data });
  } catch {
    return reply.send({ status: 1, data: [], error: "Search failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/campaigns/:id/adsets — ad sets with 30d insights
// GET /api/meta/adsets/:id/ads — ads with creative + 30d insights
// PATCH /api/meta/adsets/:id — edit budget / end_time / status / name
// ─────────────────────────────────────────────────────────────────────────────
const ADSET_FIELDS = "id,name,status,daily_budget,lifetime_budget,start_time,end_time,insights.date_preset(last_30d){spend,impressions,clicks,actions}";
const AD_FIELDS    = "id,name,status,creative{title,body,thumbnail_url},insights.date_preset(last_30d){spend,impressions,clicks,actions}";

function flattenInsights(row: any) {
  const ins = row.insights?.data?.[0] ?? {};
  return {
    spend:       ins.spend       ? Number(ins.spend)       : null,
    impressions: ins.impressions ? Number(ins.impressions) : null,
    clicks:      ins.clicks      ? Number(ins.clicks)      : null,
    leads:       Number((ins.actions ?? []).find((a: any) => a.action_type === "lead")?.value ?? 0) || null,
  };
}

export const getCampaignAdsets = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct?.access_token) return reply.status(400).send({ status: 0, message: "No Meta account" });

  const { id } = req.params as any;
  try {
    const res = await fetch(`${META_GRAPH_BASE}/${id}/adsets?fields=${encodeURIComponent(ADSET_FIELDS)}&limit=50&access_token=${encodeURIComponent(acct.access_token)}`);
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });
    const data = (json.data ?? []).map((a: any) => ({
      id: a.id, name: a.name, status: a.status,
      daily_budget: a.daily_budget ?? null, lifetime_budget: a.lifetime_budget ?? null,
      start_time: a.start_time ?? null, end_time: a.end_time ?? null,
      ...flattenInsights(a),
    }));
    return reply.send({ status: 1, data });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to fetch ad sets" });
  }
};

export const getAdsetAds = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct?.access_token) return reply.status(400).send({ status: 0, message: "No Meta account" });

  const { id } = req.params as any;
  try {
    const res = await fetch(`${META_GRAPH_BASE}/${id}/ads?fields=${encodeURIComponent(AD_FIELDS)}&limit=50&access_token=${encodeURIComponent(acct.access_token)}`);
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });
    const data = (json.data ?? []).map((a: any) => ({
      id: a.id, name: a.name, status: a.status,
      headline: a.creative?.title ?? null, body: a.creative?.body ?? null,
      thumbnail_url: a.creative?.thumbnail_url ?? null,
      ...flattenInsights(a),
    }));
    return reply.send({ status: 1, data });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to fetch ads" });
  }
};

export const updateAdset = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct?.access_token) return reply.status(400).send({ status: 0, message: "No Meta account" });

  const { id } = req.params as any;
  const { status, name, daily_budget, lifetime_budget, end_time } = req.body as any;

  const params = new URLSearchParams({ access_token: acct.access_token });
  if (status) params.set("status", status);
  if (name)   params.set("name", name);
  // Budgets arrive in major units from the UI → convert to minor units
  if (daily_budget)    params.set("daily_budget",    String(Math.round(Number(daily_budget) * 100)));
  if (lifetime_budget) params.set("lifetime_budget", String(Math.round(Number(lifetime_budget) * 100)));
  if (end_time)        params.set("end_time", String(Math.floor(new Date(end_time).getTime() / 1000)));
  if ([...params.keys()].length <= 1) return reply.status(400).send({ status: 0, message: "Nothing to update" });

  try {
    const res = await fetch(`${META_GRAPH_BASE}/${id}`, { method: "POST", body: params });
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });
    return reply.send({ status: 1, message: "Ad set updated" });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to update ad set" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Custom Audiences — sync CRM lead segments to Meta for retargeting/exclusion
// ─────────────────────────────────────────────────────────────────────────────
export const listCustomAudiences = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.send({ status: 1, data: [] });

  try {
    const res = await fetch(
      `${META_GRAPH_BASE}/act_${acct.ad_account_id}/customaudiences?fields=id,name,description,approximate_count_lower_bound,delivery_status,time_updated&limit=50&access_token=${encodeURIComponent(acct.access_token)}`
    );
    const json: any = await res.json();
    if (json.error) return reply.send({ status: 1, data: [], error: json.error.message });
    return reply.send({ status: 1, data: json.data ?? [] });
  } catch {
    return reply.send({ status: 1, data: [], error: "Failed to list audiences" });
  }
};

const sha256 = (v: string) => crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export const createCustomAudience = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.status(400).send({ status: 0, message: "No ad account linked" });

  const { name, description, segment } = req.body as { name?: string; description?: string; segment?: string };
  if (!name?.trim()) return reply.status(400).send({ status: 0, message: "name required" });

  // Pick the CRM leads for the chosen segment
  let q = (db as any)
    .selectFrom("leads")
    .select(["email", "phone"])
    .where("username", "=", username)
    .where("is_archived", "=", 0);
  if (segment === "converted")  q = q.where("is_converted", "=", 1);
  if (segment === "meta")       q = q.where("source", "=", "meta");
  if (segment === "unconverted") q = q.where("is_converted", "=", 0);
  const leads: any[] = await q.execute();

  const rows = leads
    .map((l) => [l.email ? sha256(l.email) : "", l.phone ? sha256(l.phone) : ""])
    .filter(([e, p]) => e || p);

  if (!rows.length) return reply.status(400).send({ status: 0, message: "No leads with email/phone in this segment" });

  try {
    // 1. Create the audience
    const c = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/customaudiences`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: name.trim(),
        subtype: "CUSTOM",
        description: description ?? `LeadCRM segment: ${segment ?? "all"}`,
        customer_file_source: "USER_PROVIDED_ONLY",
        access_token: acct.access_token,
      }),
    });
    const audience: any = await c.json();
    if (audience.error) return reply.status(400).send({ status: 0, message: audience.error.message });

    // 2. Upload hashed members in batches of 500
    let uploaded = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const u = await fetch(`${META_GRAPH_BASE}/${audience.id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          payload: JSON.stringify({ schema: ["EMAIL_SHA256", "PHONE_SHA256"], data: batch }),
          access_token: acct.access_token,
        }),
      });
      const uj: any = await u.json();
      if (!uj.error) uploaded += batch.length;
    }

    return reply.send({
      status: 1,
      message: `Audience created — ${uploaded} of ${rows.length} contacts uploaded (Meta matches them over ~1h)`,
      data: { audience_id: audience.id, uploaded, total: rows.length },
    });
  } catch {
    return reply.status(500).send({ status: 0, message: "Audience creation failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/meta/campaign-roi — leads/converted/revenue per campaign from CRM
// ─────────────────────────────────────────────────────────────────────────────
export const getCampaignRoi = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const rows: any[] = await (db as any)
    .selectFrom("leads")
    .select((eb: any) => [
      "meta_campaign_id",
      eb.fn.count("id").as("leads"),
      eb.fn.sum("is_converted").as("converted"),
      eb.fn.sum(eb.case().when("is_converted", "=", 1).then(eb.ref("lead_value")).else(0).end()).as("revenue"),
    ])
    .where("username", "=", username)
    .where("source", "=", "meta")
    .where("meta_campaign_id", "is not", null)
    .groupBy("meta_campaign_id")
    .execute();

  const data = rows.map((r) => ({
    campaign_id: r.meta_campaign_id,
    leads:       Number(r.leads ?? 0),
    converted:   Number(r.converted ?? 0),
    revenue:     Number(r.revenue ?? 0),
  }));

  return reply.send({ status: 1, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/capi/lead-event — manual CAPI trigger (also fires
// automatically on lead status change via updateLead controller)
// ─────────────────────────────────────────────────────────────────────────────
export const capiLeadEvent = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { lead_id, status } = req.body as { lead_id?: number; status?: string };
  if (!lead_id || !status) return reply.status(400).send({ status: 0, message: "lead_id and status required" });

  const result = await sendMetaCapiLeadEvent(username, Number(lead_id), status);
  return reply.send({ status: result.sent ? 1 : 0, message: result.sent ? "CAPI event sent" : (result.reason ?? "Not sent") });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/lead-forms/:formId/status — ACTIVE ⇄ ARCHIVED
// POST /api/meta/lead-forms/:formId/duplicate — copy a form (Meta forms are
// immutable after creation, so duplicate-and-edit is the supported "edit")
// ─────────────────────────────────────────────────────────────────────────────
export const updateFormStatus = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct?.page_id) return reply.status(400).send({ status: 0, message: "No Meta page connected" });

  const { formId } = req.params as { formId: string };
  const { status } = req.body as { status?: string };
  if (!status || !["ACTIVE", "ARCHIVED"].includes(status)) {
    return reply.status(400).send({ status: 0, message: "status must be ACTIVE or ARCHIVED" });
  }

  try {
    const pageToken = await getPageToken(acct.access_token, acct.page_id);
    const res = await fetch(`${META_GRAPH_BASE}/${encodeURIComponent(formId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status, access_token: pageToken }),
    });
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });

    await (db as any)
      .updateTable("meta_lead_forms_cache")
      .set({ status, synced_at: new Date() })
      .where("username", "=", username)
      .where("form_id", "=", String(formId))
      .execute()
      .catch(() => {});

    return reply.send({ status: 1, message: `Form ${status === "ARCHIVED" ? "archived" : "activated"}` });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to update form status" });
  }
};

export const duplicateLeadForm = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });
  const acct = await getActiveAccount(username);
  if (!acct?.page_id) return reply.status(400).send({ status: 0, message: "No Meta page connected" });

  const { formId } = req.params as { formId: string };

  try {
    const pageToken = await getPageToken(acct.access_token, acct.page_id);

    // Fetch the source form's full definition
    const src = await fetch(
      `${META_GRAPH_BASE}/${encodeURIComponent(formId)}?fields=name,questions{key,label,type,options},privacy_policy_url,thank_you_page,context_card{title,content,style}&access_token=${pageToken}`
    );
    const form: any = await src.json();
    if (form.error) return reply.status(400).send({ status: 0, message: form.error.message });

    const payload: any = {
      name: `${form.name} (Copy ${new Date().toISOString().slice(0, 10)})`,
      questions: (form.questions ?? []).map((q: any) => ({
        type: q.type,
        ...(q.type === "CUSTOM" ? { label: q.label } : {}),
        ...(q.options?.length ? { options: q.options.map((o: any) => ({ value: o.value ?? o })) } : {}),
      })),
      ...(form.privacy_policy_url ? { privacy_policy: { url: form.privacy_policy_url } } : {}),
      ...(form.thank_you_page ? { thank_you_page: form.thank_you_page } : {}),
      ...(form.context_card ? { context_card: form.context_card } : {}),
    };

    const res = await fetch(`${META_GRAPH_BASE}/${acct.page_id}/leadgen_forms?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });

    return reply.send({ status: 1, message: "Form duplicated — sync to see it in the list", data: json });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to duplicate form" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Multi-account: GET /api/meta/accounts (all rows for client)
//                POST /api/meta/accounts/:id/activate (switch active account)
// ─────────────────────────────────────────────────────────────────────────────
export const listMetaAccounts = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const rows: any[] = await (db as any)
    .selectFrom("meta_accounts")
    .select(["id", "page_id", "page_name", "ad_account_id", "instagram_account_id", "status", "updated_at"])
    .where("username", "=", username)
    .orderBy("id", "desc")
    .execute();

  return reply.send({ status: 1, data: rows });
};

export const activateMetaAccount = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const { id } = req.params as { id: string };
  const target: any = await (db as any)
    .selectFrom("meta_accounts")
    .select(["id"])
    .where("username", "=", username)
    .where("id", "=", Number(id))
    .executeTakeFirst();
  if (!target) return reply.status(404).send({ status: 0, message: "Account not found" });

  // One active account at a time — all reads go through getActiveAccount
  await (db as any).updateTable("meta_accounts").set({ status: "inactive", updated_at: new Date() }).where("username", "=", username).execute();
  await (db as any).updateTable("meta_accounts").set({ status: "active",   updated_at: new Date() }).where("id", "=", Number(id)).execute();

  return reply.send({ status: 1, message: "Account switched" });
};