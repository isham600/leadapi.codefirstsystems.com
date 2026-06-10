// validators/capture-lead.schema.ts
import { z } from "zod";

export const captureLeadSchema = z
  .object({
    first_name: z.string().min(2, "First name required"),
    last_name: z.string().optional(),
    username: z.string().optional(),
    owner_key: z.string().optional(),

    email: z.string().email().optional(),
    phone: z
      .string()
      .min(8, "mobile number required al least 8 digit minimum")
      .max(20, "mobile number required al least 20 digit minimum"),

    utm_source: z.string().optional(),
    gad_source: z.string().optional(),
    utm_campaign: z.string().optional(),
    assigned_agent_id: z.string().optional(),
    assigned_agent_name: z.string().optional(),

    gclid: z.string().optional(),
  })
  .refine((data) => data.email || data.phone, {
    message: "Either email or phone is required",
    path: ["email"],
  });
