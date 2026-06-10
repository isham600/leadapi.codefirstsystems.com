import { z } from "zod";

export const emailIntegrationSchema = z.object({
  host: z.string().min(1, "Host is required").max(255),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.union([z.boolean(), z.number()]).optional(),
  email: z.string().email("Invalid email").max(255),
  password: z.string().min(1, "Password is required").max(255),
  sender_name: z.string().max(255).optional(),
});

export type EmailIntegrationInput = z.infer<
  typeof emailIntegrationSchema
>;