// import { z } from "zod";

// export const whatsappIntegrationSchema = z.object({
//   url: z.string().optional(),
//   accessToken: z.string().min(5, "access token must be atleast 5 charecter"),
//   access_token_type: z.string(),

//   accountType: z.enum(["Personal", "Business"]),
//   provider: z.enum(["meta", "twilio", "gupshup"]),
//   whatsappNumber: z.string().min(8).max(20),
//   bmid: z.string().min(1),
//   waba_id: z.string().min(1),
  
// });

// export type WhatsAppIntegrationInput = z.infer<
//   typeof whatsappIntegrationSchema
// >;
// // 


import { z } from "zod";

export const whatsappIntegrationSchema = z.object({
  url: z.string().optional(),

  accessToken: z
    .string()
    .min(5, "Access token must be at least 5 characters"),

  access_token_type: z.enum(["bearer", "jwt_bearer", "api_key"]),

  accountType: z.enum(["Personal", "Business"]),
  provider: z.enum(["meta", "twilio", "gupshup"]),

  whatsappNumber: z
    .string()
    .regex(/^\d+$/, "WhatsApp number must contain only digits")
    .min(8)
    .max(20),

  bmid: z.string().min(1),
  waba_id: z.string().min(1),

  // ✅ NEW FIELD
  expire_at: z
    .string()
    .datetime({ message: "expire_at must be a valid datetime" })
    .optional(),
});


export type WhatsAppIntegrationInput = z.infer<
  typeof whatsappIntegrationSchema
>;