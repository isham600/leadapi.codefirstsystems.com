import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import {
  whatsappIntegrationSchema,
  WhatsAppIntegrationInput,
} from "../schema/whatsapp.schema.js";


import {
  metaIntegrationSchema,
  MetaIntegrationInput
} from "../schema/meta-integration.schema.js";

import {
  emailIntegrationSchema,
  EmailIntegrationInput,
} from "../schema/email-integration.schema.js";
 
// ============================================================
// 🔄 CREATE WHATSAPP INTEGRATION CONTROLLER
// ============================================================

export const createWhatsAppIntegration = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    /* -------------------- 1️⃣ Validate request body -------------------- */
    const body = req.body as WhatsAppIntegrationInput;
    const parse = whatsappIntegrationSchema.safeParse(body);

    if (!parse.success) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Validation error",
        data: null,
        error: parse.error.flatten(),
        validation: "validation failed",
      });
    }

    const {
      url,
      expire_at,
      accessToken,
      accountType,
      access_token_type,
      provider,
      whatsappNumber,
      bmid,
      waba_id,
    } = parse.data;

    /* -------------------- 2️⃣ Auth user from JWT -------------------- */
    const user = req.user;

    if (!user?.uuid || !user?.username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - invalid token",
        error: "token_invalid",
        data: null,
      });
    }

    const tenantId = user.uuid;
    const username = user.username;

    /* -------------------- 3️⃣ Prepare expire_at -------------------- */
    const expireAtDate = expire_at ? new Date(expire_at) : null;

    /* -------------------- 4️⃣ Insert WhatsApp account -------------------- */
    await db
      .insertInto("whatsapp_accounts")
      .values({
        tenant_id: tenantId,
        username,
        provider,
        account_type: accountType,
        access_token_type,
        phone_number: whatsappNumber,
        waba_id,
        bmid,
        access_token: accessToken,

        // ✅ NEW FIELDS
        url: url ?? null,
        expire_at: expireAtDate,

        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    /* -------------------- 5️⃣ Success response -------------------- */
    return reply.status(201).send({
      status: 1,
      statuscode: 201,
      message: "WhatsApp integration created successfully",
      data: {
        username,
        provider,
        accountType,
        access_token_type,
        expire_at,
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
      data: null,
    });
  }
};




 

 

// ============================================================
// 🔄 CREATE META (FACEBOOK) INTEGRATION CONTROLLER
// ============================================================

export const createMetaIntegration = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    /* -------------------- 1️⃣ Validate request body -------------------- */
    const body = req.body as MetaIntegrationInput;
    const parse = metaIntegrationSchema.safeParse(body);

    if (!parse.success) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Validation error",
        data: null,
        error: parse.error.flatten(),
        validation: "validation failed",
      });
    }

    const {
      access_token_type,
      access_token,
      ssid,
      page_id,
      META_APP_ID,
      META_APP_SECRET,
      META_REDIRECT_URI,
      META_WEBHOOK_VERIFY_TOKEN,
    } = parse.data;

    /* -------------------- 2️⃣ Auth user from JWT -------------------- */
    const user = req.user;

    if (!user?.uuid || !user?.username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - invalid token",
        error: "token_invalid",
        data: null,
      });
    }

    const tenantId = user.uuid;
    const username = user.username;

    /* -------------------- 3️⃣ Insert Meta integration -------------------- */
    await (db as any)
      .insertInto("meta_accounts")
      .values({
        tenant_id: tenantId,
        username,

        access_token_type,
        access_token,

        ssid,
        page_id,

        app_id:               META_APP_ID,
        app_secret:           META_APP_SECRET,
        redirect_uri:         META_REDIRECT_URI,
        webhook_verify_token: META_WEBHOOK_VERIFY_TOKEN,

        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    /* -------------------- 4️⃣ Success response -------------------- */
    return reply.status(201).send({
      status: 1,
      statuscode: 201,
      message: "Meta integration created successfully",
      data: {
        username,
        page_id,
        access_token_type,
        ssid,
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
      data: null,
    });
  }
};


 
 

export const createEmailIntegration = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    /* -------------------- 1️⃣ Validate request body -------------------- */
    const body = req.body as EmailIntegrationInput;
    const parse = emailIntegrationSchema.safeParse(body);

    if (!parse.success) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Validation error",
        data: null,
        error: parse.error.flatten(),
        validation: "validation failed",
      });
    }

    const {
      host,
      port = 587,
      secure = 0,
      email,
      password,
      sender_name = "Your App",
    } = parse.data;

    /* -------------------- 2️⃣ Auth user from JWT -------------------- */
    const user = req.user;

    if (!user?.uuid || !user?.username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - invalid token",
        error: "token_invalid",
        data: null,
      });
    }

    const useruuid = user.uuid;
    const username = user.username;

    /* -------------------- 3️⃣ Insert Email Integration -------------------- */
    await db
      .insertInto("smtpmailotp_accounts")
      .values({
         uuid: useruuid,
        username,
        host,
        port,
        secure: secure ? 1 : 0,
        email,
        password,
        sender_name,
        status: "1",
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    /* -------------------- 4️⃣ Success response -------------------- */
    return reply.status(201).send({
      status: 1,
      statuscode: 201,
      message: "Email integration created successfully",
      data: {
        host,
        port,
        secure,
        email,
        sender_name,
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
      data: null,
    });
  }
};




 
import {
  googleAdsIntegrationSchema,
  GoogleAdsIntegrationInput,
} from "../schema/google-integration.schema.js";

export const createGoogleIntegration = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    /* -------------------- 1️⃣ Validate request body -------------------- */
    const body = req.body as GoogleAdsIntegrationInput;
    const parse = googleAdsIntegrationSchema.safeParse(body);

    if (!parse.success) {
      return reply.status(400).send({
        status: 0,
        statuscode: 400,
        message: "Validation error",
        data: null,
        error: parse.error.flatten(),
        validation: "validation failed",
      });
    }

    const {
      customer_id,
      developer_token,
      login_customer_id,
      client_id,
      client_secret,
      redirect_uri,
    } = parse.data;

    /* -------------------- 2️⃣ Auth user from JWT -------------------- */
    const user = req.user;

    if (!user?.uuid || !user?.username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized - invalid token",
        error: "token_invalid",
        data: null,
      });
    }

    const Useruuid = user.uuid;
    const username = user.username;

    


    await db
  .insertInto("google_ads_integrations")
  .values({
    // tenant_id: user.tenant_id, // or wherever tenant_id comes from
    uuid: Useruuid,
    username: username,

    customer_id,
    developer_token,
    login_customer_id: login_customer_id ?? null,

    client_id: client_id ?? null,
    client_secret: client_secret ?? null,
    redirect_uri: redirect_uri ?? null,

    status: 1,
    created_at: new Date(),
    updated_at: new Date(),
  })
  .execute();

    /* -------------------- 4️⃣ Success response -------------------- */
    return reply.status(201).send({
      status: 1,
      statuscode: 201,
      message: "Google Ads integration created successfully",
      data: {
        username,
        customer_id,
        login_customer_id,
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      error: "server_error",
      data: null,
    });
  }
};



