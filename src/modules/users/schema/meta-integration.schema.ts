import { z } from "zod";

export const metaIntegrationSchema = z.object({
  access_token_type: z.string().min(1,""),
  access_token: z.string().min(1,"access token is required"),

  ssid: z.string().optional(),
  page_id: z.string().optional(),

  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().optional(),
  META_REDIRECT_URI: z.string().url().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
});

export type MetaIntegrationInput = z.infer<
  typeof metaIntegrationSchema
>;