import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import crypto from "crypto";

const META_GRAPH_API = "https://graph.instagram.com/v21.0";
const WHATSAPP_OAUTH_SCOPES = [
  "business_management_api",
  "whatsapp_business_messaging",
  "whatsapp_business_account_management",
].join(",");

// ────────────────────────────────────────────────────────────
// 🔐 OAUTH FLOW
// ────────────────────────────────────────────────────────────

export const whatsappOAuthStart = async (
  req: FastifyRequest<{ Querystring: { token?: string } }>,
  reply: FastifyReply
) => {
  try {
    const { token } = req.query;
    let username: string | undefined;

    // Extract username from token (JWT or direct)
    if (token) {
      try {
        const parts = (token as string).split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
          username = payload.username;
        }
      } catch {
        console.warn("Failed to parse token");
      }
    }

    if (!username) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    // Generate CSRF state
    const state = crypto.randomBytes(32).toString("hex");
    const stateCookie = `whatsapp_oauth_state_${state}`;

    // Store in cookie (should expire in 10 minutes)
    reply.setCookie(stateCookie, username, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    // Redirect to Meta OAuth
    const fbAppId = process.env.FACEBOOK_APP_ID || "4373151762943238";
    const backendUrl =
      process.env.BACKEND_URL || "http://127.0.0.1:3004";
    const redirectUri = `${backendUrl}/api/whatsapp/oauth/callback`;

    const oauthUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    oauthUrl.searchParams.set("client_id", fbAppId);
    oauthUrl.searchParams.set("redirect_uri", redirectUri);
    oauthUrl.searchParams.set("scope", WHATSAPP_OAUTH_SCOPES);
    oauthUrl.searchParams.set("state", state);
    oauthUrl.searchParams.set("response_type", "code");

    reply.redirect(oauthUrl.toString());
  } catch (error: any) {
    console.error("OAuth start error:", error);
    reply.status(500).send({ error: "OAuth initialization failed" });
  }
};

export const whatsappOAuthCallback = async (
  req: FastifyRequest<{ Querystring: { code?: string; state?: string } }>,
  reply: FastifyReply
) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return reply.status(400).send({ error: "Missing OAuth parameters" });
    }

    // Verify CSRF state from cookie
    const stateCookie = `whatsapp_oauth_state_${state}`;
    const username = req.cookies[stateCookie];

    if (!username) {
      return reply.status(403).send({ error: "Invalid OAuth state" });
    }

    // Exchange code for access token
    const fbAppId = process.env.FACEBOOK_APP_ID || "4373151762943238";
    const fbAppSecret = process.env.FACEBOOK_APP_SECRET || "";
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:3004";
    const redirectUri = `${backendUrl}/api/whatsapp/oauth/callback`;

    const tokenUrl = new URL("https://graph.instagram.com/v21.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", fbAppId);
    tokenUrl.searchParams.set("client_secret", fbAppSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code as string);

    const tokenRes = await fetch(tokenUrl.toString(), { method: "POST" });
    const tokenData = (await tokenRes.json()) as any;

    if (!tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return reply.status(400).send({ error: "Token exchange failed" });
    }

    const accessToken = tokenData.access_token;
    const metaUserId = tokenData.user_id;

    // Fetch user info
    const userRes = await fetch(
      `${META_GRAPH_API}/${metaUserId}?fields=id,name&access_token=${accessToken}`
    );
    const userData = (await userRes.json()) as any;

    // Fetch Business Manager info
    const businessesRes = await fetch(
      `${META_GRAPH_API}/${metaUserId}/businesses?fields=id,name&access_token=${accessToken}`
    );
    const businessesData = (await businessesRes.json()) as any;

    if (!businessesData.data || businessesData.data.length === 0) {
      return reply.status(400).send({
        error: "No business accounts found. Create a Meta Business Account first.",
      });
    }

    const businessId = businessesData.data[0].id;
    const businessName = businessesData.data[0].name;

    // Fetch WABA details
    const wabasRes = await fetch(
      `${META_GRAPH_API}/${businessId}/owned_whatsapp_business_accounts?fields=id,name&access_token=${accessToken}`
    );
    const wabasData = (await wabasRes.json()) as any;

    if (!wabasData.data || wabasData.data.length === 0) {
      return reply.status(400).send({
        error: "No WhatsApp Business Accounts found. Set up WABA in Meta Business Manager.",
      });
    }

    const wabaId = wabasData.data[0].id;
    const wabaName = wabasData.data[0].name;

    // Fetch phone numbers
    const phonesRes = await fetch(
      `${META_GRAPH_API}/${wabaId}/phone_numbers?fields=id,verified_name,quality_rating&access_token=${accessToken}`
    );
    const phonesData = (await phonesRes.json()) as any;

    const primaryPhone = phonesData.data?.[0] || {};

    // Upsert WhatsApp account
    const wabaRecord = await db
      .selectFrom("whatsapp_accounts")
      .select("id")
      .where("waba_id", "=", wabaId)
      .executeTakeFirst();

    if (wabaRecord) {
      await db
        .updateTable("whatsapp_accounts")
        .set({
          access_token: accessToken,
          meta_user_id: metaUserId,
          meta_user_name: userData.name,
          business_manager_id: businessId,
          business_name: businessName,
          status: "active",
          updated_at: new Date(),
        })
        .where("id", "=", wabaRecord.id)
        .execute();
    } else {
      await db
        .insertInto("whatsapp_accounts")
        .values({
          username,
          waba_id: wabaId,
          business_manager_id: businessId,
          business_name: wabaName,
          phone_number_id: primaryPhone.id || null,
          phone_number: primaryPhone.phone_number || null,
          access_token: accessToken,
          access_token_type: "system_user",
          meta_user_id: metaUserId,
          meta_user_name: userData.name,
          quality_rating: (primaryPhone.quality_rating as any) || "GREEN",
          status: "active",
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    }

    // Clear CSRF cookie
    reply.clearCookie(stateCookie);

    // Redirect to frontend integrations page
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    reply.redirect(`${frontendUrl}/integrations?whatsapp=connected`);
  } catch (error: any) {
    console.error("OAuth callback error:", error);
    reply.status(500).send({ error: "OAuth callback failed" });
  }
};

// ────────────────────────────────────────────────────────────
// 📋 CRUD OPERATIONS
// ────────────────────────────────────────────────────────────

export const getWhatsappAccount = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        message: "Unauthorized",
        data: null,
      });
    }

    const account = await db
      .selectFrom("whatsapp_accounts")
      .selectAll()
      .where("username", "=", username)
      .executeTakeFirst();

    if (account) {
      // Fetch phone numbers
      const phones = await db
        .selectFrom("whatsapp_phone_numbers")
        .selectAll()
        .where("waba_account_id", "=", account.id)
        .execute();

      return reply.status(200).send({
        status: 1,
        message: "WhatsApp account retrieved",
        data: {
          ...account,
          phone_numbers: phones,
        },
      });
    }

    reply.status(200).send({
      status: 1,
      message: "No WhatsApp account connected",
      data: null,
    });
  } catch (error: any) {
    console.error(error);
    reply.status(500).send({
      status: 0,
      message: "Failed to fetch account",
      error: error.message,
    });
  }
};

export const upsertWhatsappAccount = async (
  req: FastifyRequest<{
    Body: {
      waba_id: string;
      business_manager_id: string;
      business_name?: string;
      access_token: string;
      phone_number?: string;
    };
  }>,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;
    const { waba_id, business_manager_id, business_name, access_token, phone_number } = req.body;

    if (!username || !waba_id || !business_manager_id || !access_token) {
      return reply.status(400).send({
        status: 0,
        message: "Missing required fields",
        data: null,
      });
    }

    const existing = await db
      .selectFrom("whatsapp_accounts")
      .select("id")
      .where("waba_id", "=", waba_id)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable("whatsapp_accounts")
        .set({
          access_token,
          business_name: business_name || null,
          phone_number: phone_number || null,
          updated_at: new Date(),
        })
        .where("id", "=", existing.id)
        .execute();
    } else {
      await db
        .insertInto("whatsapp_accounts")
        .values({
          username,
          waba_id,
          business_manager_id,
          business_name: business_name || null,
          access_token,
          access_token_type: "system_user",
          status: "active",
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    }

    reply.status(200).send({
      status: 1,
      message: "WhatsApp account saved",
      data: { waba_id },
    });
  } catch (error: any) {
    console.error(error);
    reply.status(500).send({
      status: 0,
      message: "Failed to save account",
      error: error.message,
    });
  }
};

export const deleteWhatsappAccount = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        message: "Unauthorized",
        data: null,
      });
    }

    const account = await db
      .selectFrom("whatsapp_accounts")
      .select("id")
      .where("username", "=", username)
      .executeTakeFirst();

    if (!account) {
      return reply.status(404).send({
        status: 0,
        message: "No account found",
        data: null,
      });
    }

    await db
      .deleteFrom("whatsapp_accounts")
      .where("id", "=", account.id)
      .execute();

    reply.status(200).send({
      status: 1,
      message: "WhatsApp account disconnected",
      data: null,
    });
  } catch (error: any) {
    console.error(error);
    reply.status(500).send({
      status: 0,
      message: "Failed to delete account",
      error: error.message,
    });
  }
};

export const listPhoneNumbers = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const username = (req as any).user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        message: "Unauthorized",
        data: null,
      });
    }

    const account = await db
      .selectFrom("whatsapp_accounts")
      .select("id")
      .where("username", "=", username)
      .executeTakeFirst();

    if (!account) {
      return reply.status(200).send({
        status: 1,
        message: "No account found",
        data: [],
      });
    }

    const phones = await db
      .selectFrom("whatsapp_phone_numbers")
      .selectAll()
      .where("waba_account_id", "=", account.id)
      .orderBy("is_primary", "desc")
      .execute();

    reply.status(200).send({
      status: 1,
      message: "Phone numbers retrieved",
      data: phones,
    });
  } catch (error: any) {
    console.error(error);
    reply.status(500).send({
      status: 0,
      message: "Failed to fetch phone numbers",
      error: error.message,
    });
  }
};
