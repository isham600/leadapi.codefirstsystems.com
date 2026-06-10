import { FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { db } from "../../../models/db.js";

export const generateMasterPassword = async (
  req: FastifyRequest,
  reply: FastifyReply
) => {
  try {
     

    
    // =====================================================
    // 📥 INPUT VALIDATION
    // =====================================================
    const { new_master_password } = req.body as {
      new_master_password?: string;
      
    };

    if (!new_master_password) {
      return reply.status(422).send({
        status: 0,
        statuscode: 422,
        message: "Validation error",
        errors: {
          new_master_password: ["Master password is required"],
        },
        validation: "validation error",
      });
    }

    if (new_master_password.length < 10) {
      return reply.status(422).send({
        status: 0,
        statuscode: 422,
        message: "Validation error",
        errors: {
          new_master_password: [
            "Master password must be at least 10 characters long",
          ],
        },
        validation: "validation error",
      });
    }

    // =====================================================
    // 🔐 HASH PASSWORD
    // =====================================================
    const password_hash = await bcrypt.hash(new_master_password, 12);

    // =====================================================
    // 🔁 REVOKE OLD MASTER PASSWORDS
    // =====================================================
    await db
      .updateTable("master_passwords")
      .set({
        is_active: 0,
        revoked_at: new Date(),
      })
      .where("is_active", "=", 1)
      .execute();

    // =====================================================
    // 💾 STORE NEW MASTER PASSWORD
    // =====================================================
    await db.insertInto("master_passwords").values({
      password_hash,
      is_active: 1,
    //   created_by: body.username,
      created_at: new Date(),
    }).execute();

    // =====================================================
    // ✅ SUCCESS RESPONSE
    // =====================================================
    return reply.status(201).send({
      status: 1,
      statuscode: 201,
      message: "Master password generated successfully",
      errors: null,
      validation: null,
    });
  } catch (error) {
    req.log.error(error);

    return reply.status(500).send({
      status: 0,
      statuscode: 500,
      message: "Internal server error",
      errors: null,
      validation: null,
    });
  }
};
