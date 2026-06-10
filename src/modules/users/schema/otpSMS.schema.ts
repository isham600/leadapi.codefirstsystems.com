import { Type } from "@sinclair/typebox";

export const SendOtpSchema = {
  body: Type.Object({
    phone: Type.String({
      minLength: 8,
      maxLength: 20,
      description: "10 digit mobile number",
    }),
    purpose: Type.Union(
      [
        Type.Literal("login"),
        Type.Literal("dual_verification"),
        Type.Literal("resetpassword"),
      ],
      { description: "Why OTP was sent" }
    ),
  }),
};

export type SendOtpBodyType = {
  phone: string;
  purpose: "login" | "dual_verification" | "resetpassword";
};
