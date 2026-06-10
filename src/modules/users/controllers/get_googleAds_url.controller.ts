import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

export const getGoogleAdsUrl = async (
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
    // 📦 FETCH FROM google_url TABLE
    // =====================================================
    const googleUrls = await db
      .selectFrom("google_url")
      .select([
        "id",
        "uuid",
        "url",
        "owner_key",
        "status",
        "rate_limit",
        "created_at",
        "updated_at",
      ])
      .where("username", "=", username)
      .where("status", "=", 1) // ✅ only active URLs
      .orderBy("created_at", "desc")
      .execute();

    if (!googleUrls || googleUrls.length === 0) {
      return reply.status(404).send({
        status: 0,
        statuscode: 404,
        message: "Google Ads URL Not Available",
        error: "Google Ads URL Not Available",
        data: [],
      });
    }

    // =====================================================
    // ✅ RESPONSE
    // =====================================================
    return reply.status(200).send({
      status: 1,
      statuscode: 200,
      message: "Google Ads URL fetched successfully",
      error: null,
      data: googleUrls,
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
