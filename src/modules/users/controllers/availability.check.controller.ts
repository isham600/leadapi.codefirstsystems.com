import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../../models/db.js';
import { z } from 'zod';
import { STATUS_CODES } from 'http';
import { error } from 'console';
import { usernameCheckSchema, UsernameCheckInput ,phoneCheckSchema , phoneCheckInput,emailCheckSchema, EmailCheckInput } from "../schema/availability.schema.js";
 
 

  

 
 
// ============================================================
// 🔄 CHECK USERNAME CONTROLLER
// ============================================================

export const checkUsername = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const body = req.body as UsernameCheckInput;

  // ✅ Zod validation
  const parsed = usernameCheckSchema.safeParse(body);

  if (!parsed.success) {
    return reply.status(400).send({
      status: 0,
      available: false,
      statuscode: 400,
      message: "Invalid username",
      error: parsed.error.flatten(),
      validation: parsed.error.flatten(),
    });
  }

  const { username } = parsed.data;

  try {
    const existing = await db
      .selectFrom("users")
      .select(["username"])
      .where("username", "=", username)
      .executeTakeFirst();

    if (existing) {
      return reply.status(200).send({
        status: 0,
        available: false,
        statuscode: 200,
        message: "Username already taken",
        error: "username already exists",
        validation: {
          error: "username already exists",
        },
      });
    }

    // Available
    return reply.status(200).send({
      status: 1,
      available: true,
      statuscode: 200,
      message: "Username is available",
      error: null,
      validation: { error: null },
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      available: false,
      statuscode: 500,
      message: "Server error",
      error: "internal server error",
      validation: { error: "internal server error" },
    });
  }
};
 




 
// ============================================================
// 🔄 CHECK PHONE NUMBER CONTROLLER
// ============================================================

export const checkPhone = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const body = req.body as phoneCheckInput;

  // ✅ Validate with Zod
  const parsed = phoneCheckSchema.safeParse(body);

  if (!parsed.success) {
    return reply.status(400).send({
      status: 0,
      available: false,
      statuscode: 400,
      message: "Invalid phone number",
      error: parsed.error.flatten(),
      validation: parsed.error.flatten(),
    });
  }

  const { phone } = parsed.data;

  try {
    const existing = await db
      .selectFrom("users")
      .select(["phone"])
      .where("phone", "=", phone)
      .executeTakeFirst();

    if (existing) {
      return reply.status(200).send({
        status: 0,
        available: false,
        statuscode: 200,
        message: "phone number already registered",
        error: "phone number exists",
        validation: { error: "phone number exists" },
      });
    }

    return reply.status(200).send({
      status: 1,
      available: true,
      statuscode: 200,
      message: "phone number is available",
      error: null,
      validation: { error: null },
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      available: false,
      statuscode: 500,
      message: "Server error",
      error: "internal server error",
      validation: { error: "internal server error" },
    });
  }
};

 




 
// ============================================================
// 🔄 CHECK EMAIL  CONTROLLER
// ============================================================
export const checkEmail = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  const body = req.body as EmailCheckInput;

  // ✅ Validate with Zod
  const parsed = emailCheckSchema.safeParse(body);

  if (!parsed.success) {
    return reply.status(400).send({
      status: 0,
      available: false,
      statuscode: 400,
      message: "Invalid email format",
      error: parsed.error.flatten(),
      validation: parsed.error.flatten(),
    });
  }

  const { email } = parsed.data;

  try {
    const existing = await db
      .selectFrom("users")
      .select(["email"])
      .where("email", "=", email)
      .executeTakeFirst();

    if (existing) {
      return reply.status(200).send({
        status: 0,
        available: false,
        statuscode: 200,
        message: "Email is not availabe",
        error: "email exists",
        validation: { error: "email exists" },
      });
    }

    return reply.status(200).send({
      status: 1,
      available: true,
      statuscode: 200,
      message: "Email is available",
      error: null,
      validation: { error: null },
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      status: 0,
      available: false,
      statuscode: 500,
      message: "Server error",
      error: "internal server error",
      validation: { error: "internal server error" },
    });
  }
};
