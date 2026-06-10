import { FastifyInstance } from "fastify";
import {
  createSMPPGateway,
  getSMPPGateways,
  getSMPPGateway,
  updateSMPPGateway,
  deleteSMPPGateway,
  testSMPPGatewayConnection,
} from "../controllers/smppGateway.controller.js";
import { getSmppProfile } from "../controllers/smppProfile.controller.js";
import { verifyJwt } from "../../Middleware/auth.Middleware.js";

async function smppGatewayRoutes(fastify: FastifyInstance) {
  // Get SMPP Profile
  fastify.get("/smppProfile", {
    preHandler: verifyJwt,
    schema: {
      description: "Get SMPP Gateway profile for the authenticated user",
      tags: ["SMPP Gateway"],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "number" },
            statuscode: { type: "number" },
            message: { type: "string" },
            data: { 
              type: ["object", "null"],
              additionalProperties: true // Allow any additional properties
            },
          },
          additionalProperties: true
        },
      },
    },
    handler: getSmppProfile,
  });

  // Create SMPP Gateway
  fastify.post("/createSMPPGateway", {
    preHandler: verifyJwt,
    schema: {
      description: "Create a new SMPP Gateway",
      tags: ["SMPP Gateway"],
      body: {
        type: "object",
        required: ["gateway_name", "ip_address", "system_id", "password", "tx_port", "rx_port", "txrx_port"],
        properties: {
          gateway_name: { type: "string", maxLength: 100 },
          ip_address: { type: "string", maxLength: 255 },
          system_id: { type: "string", maxLength: 50 },
          password: { type: "string", maxLength: 255 },
          connection_mode: { type: "string", enum: ["transceiver", "transmitter_receiver"] },
          channel: { type: "string", enum: ["promotional", "transactional"] },
          tx_sessions: { type: "integer", minimum: 1 },
          rx_sessions: { type: "integer", minimum: 1 },
          txrx_sessions: { type: "integer", minimum: 1 },
          tx_port: { type: "integer", minimum: 1, maximum: 65535 },
          rx_port: { type: "integer", minimum: 1, maximum: 65535 },
          txrx_port: { type: "integer", minimum: 1, maximum: 65535 },
          address_npi: { type: "string", maxLength: 50 },
          address_ton: { type: "string", maxLength: 50 },
          gsm_encoding: { type: "string", enum: ["GSM7Bit", "UCS2", "UTF8"] },
          interface_version: { type: "string", maxLength: 10 },
          keep_alive_interval: { type: "integer", minimum: 1 },
          window_size: { type: "integer", minimum: 1 },
          system_type: { type: "string", maxLength: 50 },
          gateway_open_time: { type: "string" },
          gateway_close_time: { type: "string" },
          telemarketer_id: { type: "string", maxLength: 100 },
          async_mode: { type: "boolean" },
          status: { type: "boolean" },
          enabled_template_dlt: { type: "boolean" },
          is_hash_gateway: { type: "boolean" },
          max_tps: { type: "integer", minimum: 1 },
          priority: { type: "integer", minimum: 1 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
            data: { type: "object" },
          },
        },
        400: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
            errors: { type: "object" },
          },
        },
      },
    },
    handler: createSMPPGateway,
  });

  // Get all SMPP Gateways
  fastify.get("/smppGateways", {
    preHandler: verifyJwt,
    schema: {
      description: "Get all SMPP Gateways for the authenticated user",
      tags: ["SMPP Gateway"],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
            data: {
              type: "array",
              items: { type: "object" },
            },
          },
        },
      },
    },
    handler: getSMPPGateways,
  });

  // Get single SMPP Gateway
  fastify.get("/smppGateways/:id", {
    preHandler: verifyJwt,
    schema: {
      description: "Get a single SMPP Gateway by ID",
      tags: ["SMPP Gateway"],
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
            data: { type: "object" },
          },
        },
        404: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: getSMPPGateway,
  });

  // Update SMPP Gateway
  fastify.put("/smppGateways/:id", {
    preHandler: verifyJwt,
    schema: {
      description: "Update an SMPP Gateway",
      tags: ["SMPP Gateway"],
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          gateway_name: { type: "string", maxLength: 100 },
          ip_address: { type: "string", maxLength: 255 },
          system_id: { type: "string", maxLength: 50 },
          password: { type: "string", maxLength: 255 },
          connection_mode: { type: "string", enum: ["transceiver", "transmitter_receiver"] },
          channel: { type: "string", enum: ["promotional", "transactional"] },
          tx_sessions: { type: "integer", minimum: 1 },
          rx_sessions: { type: "integer", minimum: 1 },
          txrx_sessions: { type: "integer", minimum: 1 },
          tx_port: { type: "integer", minimum: 1, maximum: 65535 },
          rx_port: { type: "integer", minimum: 1, maximum: 65535 },
          txrx_port: { type: "integer", minimum: 1, maximum: 65535 },
          address_npi: { type: "string", maxLength: 50 },
          address_ton: { type: "string", maxLength: 50 },
          gsm_encoding: { type: "string", enum: ["GSM7Bit", "UCS2", "UTF8"] },
          interface_version: { type: "string", maxLength: 10 },
          keep_alive_interval: { type: "integer", minimum: 1 },
          window_size: { type: "integer", minimum: 1 },
          system_type: { type: "string", maxLength: 50 },
          gateway_open_time: { type: "string" },
          gateway_close_time: { type: "string" },
          telemarketer_id: { type: "string", maxLength: 100 },
          async_mode: { type: "boolean" },
          status: { type: "boolean" },
          enabled_template_dlt: { type: "boolean" },
          is_hash_gateway: { type: "boolean" },
          max_tps: { type: "integer", minimum: 1 },
          priority: { type: "integer", minimum: 1 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
            data: { type: "object" },
          },
        },
        400: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
            errors: { type: "object" },
          },
        },
        404: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: updateSMPPGateway,
  });

  // Delete SMPP Gateway
  fastify.delete("/smppGateways/:id", {
    preHandler: verifyJwt,
    schema: {
      description: "Delete an SMPP Gateway",
      tags: ["SMPP Gateway"],
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: deleteSMPPGateway,
  });

  // Test SMPP Gateway connection
  fastify.post("/smppGateways/:id/test", {
    preHandler: verifyJwt,
    schema: {
      description: "Test SMPP Gateway connection",
      tags: ["SMPP Gateway"],
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
            data: { type: "object" },
          },
        },
        400: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
            data: { type: "object" },
          },
        },
        404: {
          type: "object",
          properties: {
            status: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: testSMPPGatewayConnection,
  });
}

export default smppGatewayRoutes;