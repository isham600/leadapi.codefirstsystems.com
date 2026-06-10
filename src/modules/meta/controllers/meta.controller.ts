import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../../../models/db.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { metaSyncQueue } from "../../../queues/meta-sync.queue.js";

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
    const userRow = await db
      .selectFrom("users")
      .select(["tenant_id"] as any)
      .where("username", "=", client_username)
      .executeTakeFirst();
    const tenant_id = (userRow as any)?.tenant_id;

    if (!acct?.access_token) {
      return reply.status(200).send({ received: false });
    }

    // Exchange for page token if we have a page_id
    const access_token = acct.page_id
      ? await getPageToken(acct.access_token, acct.page_id)
      : acct.access_token;

    const leadRes = await fetch(
      `${META_GRAPH_BASE}/${encodeURIComponent(leadgen_id)}?access_token=${encodeURIComponent(access_token)}&fields=field_data,created_time`
    );

    if (!leadRes.ok) {
      return reply.status(200).send({ received: false });
    }

    const leadJson: any = await leadRes.json();

    // Parse field_data into structured fields
    const fields: Record<string, string> = {};
    (leadJson.field_data ?? []).forEach((f: any) => {
      fields[f.name?.toLowerCase()] = f.values?.[0] ?? "";
    });
    const full_name = fields["full_name"] || fields["name"] || null;
    const email     = fields["email"] || null;
    const phone     = fields["phone_number"] || fields["phone"] || null;

    await db.insertInto("leads").values({
      tenant_id,
      username: client_username,
      full_name,
      email,
      phone,
      source: "meta",
      medium: "facebook_lead_ads",
      meta_form_id: String(form_id),
      meta_lead_id: leadgen_id,
      raw_payload: JSON.stringify(leadJson),
      status: "NEW",
      lifecycle: "lead",
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    return reply.status(200).send({ received: true, mode: "real" });

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
  } = body;

  if (!name) return reply.status(400).send({ status: 0, message: "Form name is required" });

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
    privacy_policy: { url: privacy_policy_url ?? "https://example.com/privacy" },
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

  try {
    const pageToken = await getPageToken(acct.access_token, acct.page_id);

    // Follow cursor pagination to fetch all leads
    const allRaw: any[] = [];
    let url: string = `${META_GRAPH_BASE}/${formId}/leads?fields=id,created_time,field_data&access_token=${pageToken}&limit=100`;

    while (url) {
      const res = await fetch(url);
      const json: any = await res.json();
      if (json.error) return reply.status(400).send({ status: 0, message: json.error.message, data: json.error });
      allRaw.push(...(json.data ?? []));
      url = json.paging?.next ?? "";
    }

    // Parse field_data into flat objects for easy display
    const leads = allRaw.map((lead: any) => {
      const fields: Record<string, string> = {};
      (lead.field_data ?? []).forEach((f: any) => {
        fields[f.name] = f.values?.[0] ?? "";
      });
      return { id: lead.id, created_time: lead.created_time, ...fields };
    });

    return reply.send({ status: 1, data: leads, total: leads.length });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to fetch leads" });
  }
};

// GET /api/meta/insights  — ad account performance
// ─────────────────────────────────────────────────────────────────────────────
export const getInsights = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.ad_account_id) return reply.send({ status: 1, data: null });

  const q = req.query as any;
  const preset = q.date_preset ?? "last_30d";

  try {
    const res = await fetch(
      `${META_GRAPH_BASE}/act_${acct.ad_account_id}/insights?fields=spend,impressions,clicks,reach,actions&date_preset=${preset}&access_token=${acct.access_token}`
    );
    const json: any = await res.json();
    return reply.send({ status: 1, data: json.data?.[0] ?? null, error: json.error ?? null });
  } catch {
    return reply.send({ status: 1, data: null, error: "Failed to fetch insights" });
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
    headline, primary_text, description, cta_type,
    publish,
  } = body;

  if (!campaign_name || !budget_amount || !lead_form_id) {
    return reply.status(400).send({ status: 0, message: "campaign_name, budget_amount and lead_form_id are required" });
  }

  const pageToken = await getPageToken(acct.access_token, acct.page_id);
  const campaignStatus = publish ? "ACTIVE" : "PAUSED";
  // Meta budget is in lowest currency unit (paise for INR, cents for USD)
  const budgetPaise = String(Math.round(Number(budget_amount) * 100));

  const { image_url, image_hash } = body;

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
        access_token:                     pageToken,
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

    const adsetParams: any = {
      name:               adset_name ?? `${campaign_name} - Ad Set`,
      campaign_id:        campaign.id,
      optimization_goal:  "LEAD_GENERATION",
      billing_event:      "IMPRESSIONS",
      bid_strategy:       bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
      destination_type:   "ON_AD",
      promoted_object:    JSON.stringify({ page_id: acct.page_id }),
      status:             campaignStatus,
      targeting:          JSON.stringify({
        geo_locations: { countries: [country ?? "IN"] },
        age_min: age_min ?? 18,
        age_max: age_max ?? 65,
      }),
      access_token: pageToken,
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
    // - link: "http://fb.me/" required by Meta for lead gen link_data
    // - image_hash or image_url required for image-based ads (optional if not provided)
    const linkData: any = {
      message:     primary_text ?? campaign_name,
      name:        headline     ?? campaign_name,
      description: description  ?? "",
      link:        "http://fb.me/",
      call_to_action: {
        type:  cta_type ?? "SIGN_UP",
        value: { lead_gen_form_id: lead_form_id },
      },
    };
    if (image_hash) linkData.image_hash = image_hash;
    else if (image_url) linkData.picture = image_url;

    const c3 = await fetch(`${META_GRAPH_BASE}/act_${acct.ad_account_id}/adcreatives`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name:              `${campaign_name} - Creative`,
        object_story_spec: JSON.stringify({ page_id: acct.page_id, link_data: linkData }),
        access_token:      pageToken,
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
        access_token: pageToken,
      }),
    });
    const ad: any = await c4.json();
    if (ad.error) return reply.status(400).send({ status: 0, message: ad.error.message, meta_error: ad.error });

    return reply.send({
      status: 1,
      message: publish ? "Campaign published successfully" : "Campaign saved as draft",
      data: { campaign_id: campaign.id, adset_id: adset.id, creative_id: creative.id, ad_id: ad.id },
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
  const { status } = req.body as any;
  const pageToken = await getPageToken(acct.access_token, acct.page_id);

  try {
    const res = await fetch(`${META_GRAPH_BASE}/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status, access_token: pageToken }),
    });
    const json: any = await res.json();
    if (json.error) return reply.status(400).send({ status: 0, message: json.error.message });
    return reply.send({ status: 1, message: `Campaign ${status.toLowerCase()}` });
  } catch {
    return reply.status(500).send({ status: 0, message: "Failed to update campaign" });
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
      "ad_account_id", "business_id", "instagram_account_id",
      "status", "created_at", "updated_at",
    ])
    .where("username", "=", username)
    .where("status", "=", "active")
    .orderBy("id", "desc")
    .executeTakeFirst();

  return reply.send({ status: 1, statuscode: 200, message: "OK", data: account ?? null });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/account  — manual entry (upsert)
// ─────────────────────────────────────────────────────────────────────────────
export const upsertMetaAccount = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const body = req.body as any;
  const { access_token, page_id, page_name, access_token_type, ssid,
          ad_account_id, business_id, instagram_account_id } = body;

  if (!access_token) {
    return reply.status(400).send({ status: 0, message: "access_token is required" });
  }

  const existing = await (db as any)
    .selectFrom("meta_accounts")
    .select(["id"])
    .where("username", "=", username)
    .executeTakeFirst();

  if (existing) {
    await (db as any)
      .updateTable("meta_accounts")
      .set({
        access_token,
        access_token_type: access_token_type ?? "page",
        page_id:            page_id            ?? null,
        page_name:          page_name          ?? null,
        ssid:               ssid               ?? null,
        ad_account_id:      ad_account_id      ?? null,
        business_id:        business_id        ?? null,
        instagram_account_id: instagram_account_id ?? null,
        status: "active",
        updated_at: new Date(),
      })
      .where("username", "=", username)
      .execute();
  } else {
    const userRow: any = await (db as any)
      .selectFrom("users")
      .select(["uuid"])
      .where("username", "=", username)
      .executeTakeFirst();

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

  await metaSyncQueue.add(
    `meta-sync-cache-${username}-${Date.now()}`,
    { username, accountId: acct.id, pageId: acct.page_id, adAccountId: acct.ad_account_id ?? null, accessToken: acct.access_token, syncType: "cache" },
    { priority: 1 }
  );

  return reply.status(202).send({ status: 1, message: "Cache sync queued — lead forms & campaigns will refresh in a few seconds" });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/meta/sync-leads  — pull all Meta form leads into the lead manager
// ─────────────────────────────────────────────────────────────────────────────
export const syncMetaLeads = async (req: FastifyRequest, reply: FastifyReply) => {
  const username = req.user?.username;
  if (!username) return reply.status(401).send({ status: 0, message: "Unauthorized" });

  const acct = await getActiveAccount(username);
  if (!acct?.page_id) return reply.status(400).send({ status: 0, message: "No Meta page connected" });

  await metaSyncQueue.add(
    `meta-sync-leads-${username}-${Date.now()}`,
    { username, accountId: acct.id, pageId: acct.page_id, adAccountId: acct.ad_account_id ?? null, accessToken: acct.access_token, syncType: "leads" },
    { priority: 2 }
  );

  return reply.status(202).send({ status: 1, message: "Lead sync queued — leads will appear in Lead Manager shortly" });
};