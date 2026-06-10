import { z } from "zod";

// export const googleAdsIntegrationSchema = z.object({
//   customer_id: z
//     .string()
//     .min(1, "Customer ID is required")
//     .max(15),

//   developer_token: z
//     .string()
//     .min(1, "Developer token is required")
//     .max(255),

//   login_customer_id: z
//     .string()
//     .max(15)
//     .optional(),

//   client_id: z
//     .string()
//     .max(255)
//     .optional(),

//   client_secret: z
//     .string()
//     .max(255)
//     .optional(),

//   redirect_uri: z
//     .string()
//     .url("Invalid redirect URI")
//     .max(255)
//     .optional(),
// });


 

export const googleAdsIntegrationSchema = z.object({
  customer_id: z
    .string()
    .max(15)
    .optional(),

  developer_token: z
    .string()
    .max(255)
    .optional(),

  login_customer_id: z
    .string()
    .max(15)
    .optional(),

  client_id: z
    .string()
    .max(255)
    .optional(),

  client_secret: z
    .string()
    .max(255)
    .optional(),

  redirect_uri: z
    .string()
    // .url("Invalid redirect URI")
    .max(255)
    .optional(),
});
export type GoogleAdsIntegrationInput = z.infer<
  typeof googleAdsIntegrationSchema
>;