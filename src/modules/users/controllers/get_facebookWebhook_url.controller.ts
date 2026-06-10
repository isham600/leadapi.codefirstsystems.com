import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

export const getFacebookWebhookUrl = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // =====================================================
    // 🔐 AUTHENTICATED USER
    // =====================================================
    const username = req.user?.username;

    if (!username) {
      return reply.status(401).send({
        status: 0,
        statuscode: 401,
        message: "Unauthorized",
        error: "unauthorized",
        data: null,
      });
    }

    // =====================================================
    // 📦 FETCH FROM  webhook TABLE
    // =====================================================
    const FacebookWebhookUrls = await db
      .selectFrom("webhook")
      .select([
        "id",

        "username",
        "uuid",
        "secret_key",
        "url",
        "status",
        "search",
        "rate_limit",

        "created_at",
        "updated_at",
      ])
      .where("username", "=", username)
      //   .where("status", "=", 1) // ✅ only active URLs
      .orderBy("created_at", "desc")
      .execute();

    if (!FacebookWebhookUrls || FacebookWebhookUrls.length === 0) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Facebook Webhook Url URL not found",
        error: " Facebook Webhook url_not_found",
        data: [],
      });
    }

    // =====================================================
    // ✅ RESPONSE
    // =====================================================
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: " Facebook Webhook  URL fetched successfully",
      error: null,
      data: FacebookWebhookUrls,
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
