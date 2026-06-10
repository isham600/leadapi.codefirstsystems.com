import { z } from "zod";

// Username must be at least 3 characters
export const usernameCheckSchema = z.object({
  username: z.string().min(3).max(255),
});
export type UsernameCheckInput = z.infer<typeof usernameCheckSchema>;

// phone number between 8–20 digits
export const phoneCheckSchema = z.object({
  phone: z.string().min(8).max(20),
});
export type phoneCheckInput = z.infer<typeof phoneCheckSchema>;

// Email correct format
export const emailCheckSchema = z.object({
  email: z.string().email().max(255),
});
export type EmailCheckInput = z.infer<typeof emailCheckSchema>;
