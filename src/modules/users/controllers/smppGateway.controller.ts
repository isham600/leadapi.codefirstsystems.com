import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../../models/db.js";
import { 
  smppGatewaySchema, 
  updateSMPPGatewaySchema, 
  gatewayIdSchema,
  type SMPPGatewayInput,
  type UpdateSMPPGatewayInput 
} from "../schema/smpp-gateway.schema.js";

// Helper function to normalize gateway data
const normalizeGateway = (gateway: any) => {
  if (!gateway) return null;
  
  return {
    ...gateway,
    status: gateway.status === "active",
    async_mode: Boolean(gateway.async_mode),
    enabled_template_dlt: Boolean(gateway.enabled_template_dlt),
    is_hash_gateway: Boolean(gateway.is_hash_gateway),
    created_at: gateway.created_at?.toISOString(),
    updated_at: gateway.updated_at?.toISOString(),
    last_state_change: gateway.last_state_change?.toISOString(),
  };
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

// Create SMPP Gateway
export const createSMPPGateway = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const parsed = smppGatewaySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ 
        status: false, 
        message: "Validation failed",
        errors: parsed.error.flatten() 
      });
    }

    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({
        status: false,
        message: "Unauthorized"
      });
    }

    const data = parsed.data;

    // Check if gateway name already exists for this user
    const existingGateway = await db
      .selectFrom("smpp_gateways")
      .select("id")
      .where("username", "=", username)
      .where("gateway_name", "=", data.gateway_name)
      .executeTakeFirst();

    if (existingGateway) {
      return reply.status(400).send({
        status: false,
        message: "Gateway name already exists for this user. Please choose another name.",
      });
    }

    // Insert and capture inserted id
    const result = await db
      .insertInto("smpp_gateways")
      .values({
        username,
        ...data,
        status: data.status ? "active" : "inactive",
        connection_state: "DISCONNECTED",
        created_at: new Date(),
        updated_at: new Date(),
      } as any) // Type assertion to bypass strict typing for insert
      .executeTakeFirst();

    const insertId = Number(result.insertId);

    // Fetch the inserted row
    const gateway = await db
      .selectFrom("smpp_gateways")
      .selectAll()
      .where("id", "=", insertId)
      .executeTakeFirst();

    return reply.send({
      status: true,
      message: "Gateway created successfully",
      data: normalizeGateway(gateway),
    });
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      return reply.status(400).send({
        status: false,
        message: "Gateway name already exists for this user. Please choose another name.",
      });
    }

    req.log.error({ err }, "❌ Error in createSMPPGateway");
    return reply.status(500).send({ 
      status: false, 
      message: "Internal server error" 
    });
  }
};

// Get all SMPP Gateways for user
export const getSMPPGateways = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({
        status: false,
        message: "Unauthorized"
      });
    }

    const gateways = await db
      .selectFrom("smpp_gateways")
      .selectAll()
      .where("username", "=", username)
      .orderBy("created_at", "desc")
      .execute();

    return reply.send({
      status: true,
      message: "Gateways retrieved successfully",
      data: gateways.map(normalizeGateway),
    });
  } catch (err) {
    req.log.error({ err }, "❌ Error in getSMPPGateways");
    return reply.status(500).send({ 
      status: false, 
      message: "Internal server error" 
    });
  }
};

// Get single SMPP Gateway
export const getSMPPGateway = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const parsed = gatewayIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ 
        status: false, 
        message: "Invalid gateway ID" 
      });
    }

    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({
        status: false,
        message: "Unauthorized"
      });
    }

    const { id } = parsed.data;

    const gateway = await db
      .selectFrom("smpp_gateways")
      .selectAll()
      .where("id", "=", id)
      .where("username", "=", username)
      .executeTakeFirst();

    if (!gateway) {
      return reply.status(404).send({
        status: false,
        message: "Gateway not found",
      });
    }

    return reply.send({
      status: true,
      message: "Gateway retrieved successfully",
      data: normalizeGateway(gateway),
    });
  } catch (err) {
    req.log.error({ err }, "❌ Error in getSMPPGateway");
    return reply.status(500).send({ 
      status: false, 
      message: "Internal server error" 
    });
  }
};

// Update SMPP Gateway
export const updateSMPPGateway = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const paramsParsed = gatewayIdSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ 
        status: false, 
        message: "Invalid gateway ID" 
      });
    }

    const bodyParsed = updateSMPPGatewaySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({ 
        status: false, 
        message: "Validation failed",
        errors: bodyParsed.error.flatten() 
      });
    }

    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({
        status: false,
        message: "Unauthorized"
      });
    }

    const { id } = paramsParsed.data;
    const data = bodyParsed.data;

    // Check if gateway exists and belongs to user
    const existingGateway = await db
      .selectFrom("smpp_gateways")
      .select("id")
      .where("id", "=", id)
      .where("username", "=", username)
      .executeTakeFirst();

    if (!existingGateway) {
      return reply.status(404).send({
        status: false,
        message: "Gateway not found",
      });
    }

    // Check for duplicate gateway name (excluding current gateway)
    if (data.gateway_name) {
      const duplicateGateway = await db
        .selectFrom("smpp_gateways")
        .select("id")
        .where("username", "=", username)
        .where("gateway_name", "=", data.gateway_name)
        .where("id", "!=", id)
        .executeTakeFirst();

      if (duplicateGateway) {
        return reply.status(400).send({
          status: false,
          message: "Gateway name already exists for this user. Please choose another name.",
        });
      }
    }

    // Prepare update data
    const updateData: any = {
      ...data,
      updated_at: new Date(),
    };

    // Convert status boolean to string if provided
    if (typeof data.status === "boolean") {
      updateData.status = data.status ? "active" : "inactive";
    }

    // Remove id from update data
    delete updateData.id;

    // Update gateway
    await db
      .updateTable("smpp_gateways")
      .set(updateData)
      .where("id", "=", id)
      .where("username", "=", username)
      .execute();

    // Fetch updated gateway
    const updatedGateway = await db
      .selectFrom("smpp_gateways")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    return reply.send({
      status: true,
      message: "Gateway updated successfully",
      data: normalizeGateway(updatedGateway),
    });
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      return reply.status(400).send({
        status: false,
        message: "Gateway name already exists for this user. Please choose another name.",
      });
    }

    req.log.error({ err }, "❌ Error in updateSMPPGateway");
    return reply.status(500).send({ 
      status: false, 
      message: "Internal server error" 
    });
  }
};

// Delete SMPP Gateway
export const deleteSMPPGateway = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const parsed = gatewayIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({
        status: false,
        message: "Invalid gateway ID"
      });
    }

    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({
        status: false,
        message: "Unauthorized"
      });
    }

    const { id } = parsed.data;

    // Check if gateway exists and belongs to user
    const existingGateway = await db
      .selectFrom("smpp_gateways")
      .select("id")
      .where("id", "=", id)
      .where("username", "=", username)
      .executeTakeFirst();

    if (!existingGateway) {
      return reply.status(404).send({
        status: false,
        message: "Gateway not found",
      });
    }

    // Delete gateway
    await db
      .deleteFrom("smpp_gateways")
      .where("id", "=", id)
      .where("username", "=", username)
      .execute();

    return reply.send({
      status: true,
      message: "Gateway deleted successfully",
    });
  } catch (err) {
    req.log.error({ err }, "❌ Error in deleteSMPPGateway");
    return reply.status(500).send({ 
      status: false, 
      message: "Internal server error" 
    });
  }
};

// Test SMPP Gateway connection
export const testSMPPGatewayConnection = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const parsed = gatewayIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({
        status: false,
        message: "Invalid gateway ID"
      });
    }

    const username = await resolveAccountUsername(req);
    if (!username) {
      return reply.status(401).send({
        status: false,
        message: "Unauthorized"
      });
    }

    const { id } = parsed.data;

    // Get gateway details
    const gateway = await db
      .selectFrom("smpp_gateways")
      .selectAll()
      .where("id", "=", id)
      .where("username", "=", username)
      .executeTakeFirst();

    if (!gateway) {
      return reply.status(404).send({
        status: false,
        message: "Gateway not found",
      });
    }

    // TODO: Implement actual SMPP connection test
    // For now, simulate a connection test
    const isConnected = Math.random() > 0.3; // 70% success rate for demo

    if (isConnected) {
      // Update connection state
      await db
        .updateTable("smpp_gateways")
        .set({
          connection_state: "CONNECTED",
          last_state_change: new Date(),
          updated_at: new Date(),
        })
        .where("id", "=", id)
        .execute();

      return reply.send({
        status: true,
        message: "Gateway connection test successful",
        data: { connected: true },
      });
    } else {
      // Update connection state
      await db
        .updateTable("smpp_gateways")
        .set({
          connection_state: "DISCONNECTED",
          last_state_change: new Date(),
          updated_at: new Date(),
        })
        .where("id", "=", id)
        .execute();

      return reply.status(400).send({
        status: false,
        message: "Gateway connection test failed",
        data: { connected: false },
      });
    }
  } catch (err) {
    req.log.error({ err }, "❌ Error in testSMPPGatewayConnection");
    return reply.status(500).send({ 
      status: false, 
      message: "Internal server error" 
    });
  }
};