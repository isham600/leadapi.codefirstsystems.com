import { z } from "zod";


// ---------------- RGISTER VALIDATION SCHEMA ----------------
export const registrationSchema = z.object({
  firstname: z.string().min(1).max(50),
  lastname: z.string().min(1).max(50),
  email: z.string().email().max(255),
  username: z.string().min(3).max(255),
  password: z.string().min(8).max(255),
  phone: z.string().min(8).max(20),
});
export type RegistrationInput = z.infer<typeof registrationSchema>;


// ---------------- LOGIN VALIDATION SCHEMA ----------------
export const loginSchema = z.object({
  email_or_username: z.string().max(255),
  password: z.string().max(255),
});

 
export type LoginInput = z.infer<typeof loginSchema>;

// Helper to validate email structure
export const isValidEmail = (input: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
};



// ---------------- CHECK PASSWORD SCHEMA ----------------
export const checkPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
});

export type CheckPasswordInput = z.infer<typeof checkPasswordSchema>;





 

export const editProfileSchema = z.object({
 firstname: z.string().min(1).max(50),
  lastname: z.string().min(1).max(50),
  email: z.string().email().max(255),
  phone: z.string().min(8).max(20),
  country_name: z.string().optional(),
  country_code: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  address_line: z.string().optional()
});



export type editProfileSchema = z.infer<typeof editProfileSchema>;




export const fileSchema = z.object({
  mimetype: z.string().refine(
    (type) => ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(type),
    "Invalid file type"
  ),
  filename: z.string(),
});

export type  fileSchema = z.infer<typeof  fileSchema>;





// ---------------- RGISTER VALIDATION SCHEMA ----------------
export const addUserSchema = z.object({
  firstname: z.string().min(1).max(50),
  lastname: z.string().min(1).max(50),
  email: z.string().email().max(255),
  username: z.string().min(3).max(255),
  password: z.string().min(8).max(255),
  phone: z.string().min(8).max(20),
  team: z.string().trim().max(100).optional().default(""),
  role: z.enum(["admin", "reseller", "user", "agent"]).optional(),
  permissions: z.array(z.enum([
    "create_client",
    "view_leads",
    "edit_leads",
    "manage_users",
    "view_reports",
    "manage_automations",
    "billing_access"
  ])).optional().default([]),
  sidebar_permissions: z.array(z.string()).optional().default([]),
  can_create_reseller: z.boolean().optional().default(false),
});
export type addUserInput = z.infer<typeof addUserSchema>;


 

export const updateUserSchema = z.object({
  firstname: z.string().min(1).max(50),
  lastname: z.string().min(1).max(50),
  email: z.string().email().max(255),
  phone: z.string().min(8).max(20),
  password: z.string().min(8).max(255).optional(),
  role: z.enum(["admin", "reseller", "user", "agent"]).optional(),
  team: z.string().trim().max(100).optional().default(""),
  permissions: z.array(z.enum([
    "create_client",
    "view_leads",
    "edit_leads",
    "manage_users",
    "view_reports",
    "manage_automations",
    "billing_access"
  ])).optional().default([]),
  sidebar_permissions: z.array(z.string()).optional().default([]),
  can_create_reseller: z.boolean().optional().default(false),
});
