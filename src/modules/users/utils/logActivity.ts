import { FastifyRequest } from "fastify";
import { db } from "../../../models/db.js";
import { UAParser } from "ua-parser-js";

export interface LogActivityParams {
  username?: string | null;
  uuid?: string | null;
  action: string;
  description?: string | null;
  ip_address?: string | null;
  device_info?: string | null;
}

/**
 * Utility function to log user activities to activity_log table
 */

export const logActivity = async (
  req: FastifyRequest,
  params: LogActivityParams
): Promise<void> => {
  try {
    // Extract IP address from request
    const ip_address =
      params.ip_address ||
      req.ip ||
      (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      req.headers["x-real-ip"] ||
      "0.0.0.0";

    // Extract device information from User-Agent header
    let device_info = params.device_info || null;
    if (!device_info && req.headers["user-agent"]) {
      const parser = new UAParser(req.headers["user-agent"]);
      const browser = parser.getBrowser();
      const os = parser.getOS();
      const device = parser.getDevice();
      
      device_info = JSON.stringify({
        browser: `${browser.name || "Unknown"} ${browser.version || ""}`.trim(),
        os: `${os.name || "Unknown"} ${os.version || ""}`.trim(),
        device: device.model || device.type || "Desktop",
        userAgent: req.headers["user-agent"],
      });
    }

    // Insert activity log
    await db
      .insertInto("activity_log")
      .values({
        username: params.username || null,
        uuid: params.uuid || null,
        action: params.action,
        description: params.description || null,
        ip_address: typeof ip_address === "string" ? ip_address : String(ip_address) || "0.0.0.0",
        device_info: device_info,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
  } catch (error) {
    // Log error but don't throw - activity logging should not break the main flow
    console.error("Error logging activity:", error);
  }
};

