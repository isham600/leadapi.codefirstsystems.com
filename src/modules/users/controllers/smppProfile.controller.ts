import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";

// Normalize BigInt values and Dates for JSON serialization
const normalizeBigInt = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(normalizeBigInt);
  if (typeof obj === 'object') {
    const normalized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      normalized[key] = normalizeBigInt(value);
    }
    return normalized;
  }
  return obj;
};

async function resolveAccountUsername(req: FastifyRequest): Promise<string | null> {
  const username = (req as any).user?.username ?? null;
  if (!username) return null;
  const userType = (req as any).user?.user_type as number | undefined;
  if (userType === 5) {
    const parentRow: any = await (db as any)
      .selectFrom("users")
      .select(["parent_username"])
      .where("username", "=", username)
      .executeTakeFirst();
    return parentRow?.parent_username ?? username;
  }
  return username;
}

export const getSmppProfile = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  console.log("🚀 SMPP Profile API called");

  const username = await resolveAccountUsername(req);
  console.log("👤 Username from JWT:", username);

  if (!username) {
    console.log("❌ No username found in JWT");
    return reply.status(401).send({
      status: 0,
      statuscode: 401,
      message: "Unauthorized",
      data: null
    });
  }

  try {
    console.log("🔍 Searching for SMPP gateway with username:", username);
    
    // Get the SMPP gateway from DB (simplified query)
    const gateway: any = await (db as any)
      .selectFrom("smpp_gateways")
      .selectAll()
      .where("username", "=", username)
      .executeTakeFirst();

    console.log("🎯 Found gateway:", gateway);
    console.log("🎯 Gateway type:", typeof gateway);
    console.log("🎯 Gateway keys:", gateway ? Object.keys(gateway) : "null");

    if (!gateway) {
      console.log("❌ No gateway found for username:", username);
      return reply.status(200).send({
        status: 0,
        statuscode: 200,
        message: "No SMPP gateway found",
        data: null,
      });
    }

    // Check if gateway is active
    console.log("📊 Gateway status:", gateway.status);
    if (gateway.status !== "active") {
      console.log("⚠️ Gateway not active, status:", gateway.status);
      return reply.status(200).send({
        status: 0,
        statuscode: 200,
        message: `SMPP gateway found but status is: ${gateway.status}`,
        data: null,
      });
    }

    console.log("✅ Active gateway found, preparing response");

    // ── 2. Get statistics (placeholder values) ──
    const stats = {
      totalShortcodes: 3,
      totalLeads: 1247,
      totalMessagesSent: 5680,
      totalMessagesReceived: 2340,
    };

    const responseData = {
      // Gateway information
      gateway: {
        id: gateway.id,
        gateway_name: gateway.gateway_name,
        system_id: gateway.system_id,
        host: gateway.ip_address,
        port: gateway.txrx_port || gateway.tx_port || gateway.rx_port,
        status: gateway.status,
        connection_state: gateway.connection_state,
        connection_mode: gateway.connection_mode,
        channel: gateway.channel,
        priority: gateway.priority,
        max_tps: gateway.max_tps,
        connected_at: gateway.created_at,
        last_state_change: gateway.last_state_change,
      },
      // Configuration details
      config: {
        system_type: gateway.system_type,
        interface_version: gateway.interface_version,
        window_size: gateway.window_size,
        keep_alive_interval: gateway.keep_alive_interval,
        gsm_encoding: gateway.gsm_encoding,
        address_npi: gateway.address_npi,
        address_ton: gateway.address_ton,
        async_mode: gateway.async_mode,
        gateway_open_time: gateway.gateway_open_time,
        gateway_close_time: gateway.gateway_close_time,
      },
      // Session details
      sessions: {
        tx_sessions: gateway.tx_sessions,
        rx_sessions: gateway.rx_sessions,
        txrx_sessions: gateway.txrx_sessions,
        tx_port: gateway.tx_port,
        rx_port: gateway.rx_port,
        txrx_port: gateway.txrx_port,
      },
      // Statistics
      stats,
    };

    // Normalize any BigInt values
    const normalizedData = normalizeBigInt(responseData);

    console.log("📤 Sending response data:", JSON.stringify(normalizedData, null, 2));

    const finalResponse = {
      status: 1,
      statuscode: 200,
      message: "SMPP profile fetched",
      data: normalizedData,
    };

    console.log("🔥 Final response being sent:", JSON.stringify(finalResponse, null, 2));

    return reply.code(200).send(finalResponse);
  } catch (err) {
    console.error("❌ SMPP Profile Error:", err);
    req.log.error(err, "[smppProfile] failed to fetch SMPP profile");
    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Failed to fetch SMPP profile",
      data: null,
    });
  }
};