import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

function buildAuthHeader(tokenType: string | null, token: string): string {
  const type = (tokenType ?? "bearer").toLowerCase();
  if (type === "apikey") return `ApiKey ${token}`;
  return `Bearer ${token}`;
}

export const getWhatsappProfile = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const username = req.user?.username;
  if (!username) {
    return reply.status(401).send({ status: 0, statuscode: 401, message: "Unauthorized", data: null });
  }

  // ── Agent hierarchy ───────────────────────────────────────
  const userType = (req as any).user?.user_type as number | undefined;
  let accountUsername = username;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    accountUsername = parentRow?.parent_username ?? username;
  }

  // ── 1. Get active WhatsApp account from DB ────────────────
  const account: any = await (db as any)
    .selectFrom("whatsapp_accounts")
    .select([
      "id",
      "phone_number",
      "phone_number_id",
      "provider",
      "account_type",
      "url",
      "access_token",
      "access_token_type",
      "status",
      "created_at",
    ])
    .where("username", "=", accountUsername)
    .where("status", "=", "active")
    .executeTakeFirst();

  if (!account) {
    return reply.status(200).send({
      status: 0,
      statuscode: 200,
      message: "No active WhatsApp account found",
      data: null,
    });
  }

  const phoneNumberId: string = String(account.phone_number_id);
  const accessToken: string   = account.access_token;

  if (!phoneNumberId || !accessToken) {
    return reply.status(200).send({
      status: 0,
      statuscode: 200,
      message: "Phone number ID or access token missing",
      data: { account },
    });
  }

  // Use account.url if set (custom/on-prem BSP), else Meta Graph API
  const graphBase  = (account.url as string | null)?.replace(/\/$/, "")
    ?? "https://graph.facebook.com/v21.0";
  const authHeader = buildAuthHeader(account.access_token_type, accessToken);

  try {
    // ── 2. Fetch phone number details + business profile in parallel ──
    const [phoneRes, profileRes] = await Promise.all([
      fetch(
        `${graphBase}/${phoneNumberId}` +
        `?fields=verified_name,code_verification_status,display_phone_number,` +
        `quality_rating,platform_type,throughput,last_onboarded_time`,
        { headers: { Authorization: authHeader } }
      ),
      fetch(
        `${graphBase}/${phoneNumberId}/whatsapp_business_profile` +
        `?fields=about,address,description,email,profile_picture_url,websites,vertical`,
        { headers: { Authorization: authHeader } }
      ),
    ]);

    const [phoneJson, profileJson]: [any, any] = await Promise.all([
      phoneRes.json(),
      profileRes.json(),
    ]);

    // ── 3. Log errors but don't fail the whole request ───────
    if (phoneJson.error) {
      req.log.warn({ error: phoneJson.error }, "[whatsappProfile] phone number API error");
    }
    if (profileJson.error) {
      req.log.warn({ error: profileJson.error }, "[whatsappProfile] business profile API error");
    }

    const businessProfile = profileJson.data?.[0] ?? profileJson;

    return reply.send({
      status: 1,
      statuscode: 200,
      message: "WhatsApp profile fetched",
      data: {
        // From DB
        account: {
          id:           account.id,
          phone_number: account.phone_number,
          provider:     account.provider,
          account_type: account.account_type,
          status:       account.status,
          connected_at: account.created_at,
        },
        // From Meta — phone number details
        phone: {
          verified_name:             phoneJson.verified_name        ?? null,
          display_phone_number:      phoneJson.display_phone_number ?? null,
          code_verification_status:  phoneJson.code_verification_status ?? null,
          quality_rating:            phoneJson.quality_rating        ?? null,
          platform_type:             phoneJson.platform_type         ?? null,
          throughput:                phoneJson.throughput            ?? null,
          last_onboarded_time:       phoneJson.last_onboarded_time   ?? null,
        },
        // From Meta — business profile
        profile: {
          about:               businessProfile.about               ?? null,
          description:         businessProfile.description         ?? null,
          email:               businessProfile.email               ?? null,
          address:             businessProfile.address             ?? null,
          vertical:            businessProfile.vertical            ?? null,
          websites:            businessProfile.websites            ?? [],
          profile_picture_url: businessProfile.profile_picture_url ?? null,
        },
      },
    });
  } catch (err) {
    req.log.error(err, "[whatsappProfile] failed to fetch from Meta");
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch WhatsApp profile from Meta",
      data: null,
    });
  }
};
