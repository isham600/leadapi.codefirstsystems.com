import { z } from "zod";

// SMPP Gateway validation schema
export const smppGatewaySchema = z.object({
  // Basic Information
  gateway_name: z.string().min(1, "Gateway name is required").max(100, "Gateway name too long"),
  ip_address: z.string().min(1, "IP address is required").max(255, "IP address too long"),
  system_id: z.string().min(1, "System ID is required").max(50, "System ID too long"),
  password: z.string().min(1, "Password is required").max(255, "Password too long"),
  connection_mode: z.enum(["transceiver", "transmitter_receiver"]).default("transceiver"),
  channel: z.enum(["promotional", "transactional"]).default("promotional"),
  
  // Session Configuration
  tx_sessions: z.number().int().min(1).default(10),
  rx_sessions: z.number().int().min(1).default(2),
  txrx_sessions: z.number().int().min(1).default(2),
  
  // Port Configuration
  tx_port: z.number().int().min(1).max(65535),
  rx_port: z.number().int().min(1).max(65535),
  txrx_port: z.number().int().min(1).max(65535),
  
  // Additional Settings
  address_npi: z.string().max(50).optional(),
  address_ton: z.string().max(50).optional(),
  gsm_encoding: z.enum(["GSM7Bit", "UCS2", "UTF8"]).default("GSM7Bit"),
  interface_version: z.string().max(10).default("3.4"),
  keep_alive_interval: z.number().int().min(1).default(30),
  window_size: z.number().int().min(1).default(900),
  system_type: z.string().max(50).optional(),
  gateway_open_time: z.string().default("09:00:00"),
  gateway_close_time: z.string().default("20:00:00"),
  telemarketer_id: z.string().max(100).optional(),
  
  // Toggle Options
  async_mode: z.boolean().default(false),
  status: z.boolean().default(true),
  enabled_template_dlt: z.boolean().default(false),
  is_hash_gateway: z.boolean().default(false),
  
  // Optional fields for updates
  max_tps: z.number().int().min(1).optional(),
  priority: z.number().int().min(1).default(1),
});

// Schema for updating gateway
export const updateSMPPGatewaySchema = smppGatewaySchema.partial().extend({
  id: z.number().int().min(1),
});

// Schema for gateway ID parameter
export const gatewayIdSchema = z.object({
  id: z.string().transform((val) => parseInt(val, 10)).refine((val) => !isNaN(val) && val > 0, {
    message: "Invalid gateway ID",
  }),
});

export type SMPPGatewayInput = z.infer<typeof smppGatewaySchema>;
export type UpdateSMPPGatewayInput = z.infer<typeof updateSMPPGatewaySchema>;
export type GatewayIdInput = z.infer<typeof gatewayIdSchema>;