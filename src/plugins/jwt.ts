 



import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

/* =====================================================
   🔹 SAFE JWT EXPIRES TYPE
===================================================== */
type JwtExpiresIn =
  | number
  | `${number}${"s" | "m" | "h" | "d" | "w" | "y"}`;

/* =====================================================
   🔹 TYPE GUARD
   -----------------------------------------------------
   Runtime + TypeScript dono ko batata hai:
   "haan, ye valid JwtExpiresIn string hai"
===================================================== */
function isJwtExpiresIn(value: unknown): value is JwtExpiresIn {
  if (typeof value === "number") return true;
  if (typeof value !== "string") return false;

  return /^[0-9]+[smhdwy]$/.test(value);
}

/* -------------------------------------------
   🔹 Fastify Type Augmentations
-------------------------------------------- */
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      uuid?: string;
      id?: number;
      username?: string;
      user_type?: number;
      token_type?: "access" | "session";
    };
    user: {
      uuid?: string;
      id?: number;
      username?: string;
      user_type?: number;
      token_type?: "access" | "session";
      iat?: number;
      exp?: number;
    };
  }
}

/* -------------------------------------------
   🔹 Token Generator Payload
-------------------------------------------- */
type GenerateJwtPayload = {
  uuid?: string;
  id?: number;
  username?: string;
  user_type?: number;

  // backward compatible — DO NOT CHANGE
  expiresIn?: string | number;

  tokenType?: "access" | "session";
};

/* =====================================================
   🔐 CENTRAL JWT TOKEN GENERATOR
===================================================== */
export const generateJwtToken = (params: GenerateJwtPayload) => {
  const {
    uuid,
    id,
    username,
    user_type,
    tokenType = "session",
    expiresIn,
  } = params;

  const secretEnv = process.env.JWT_SECRET;
  if (!secretEnv) {
    throw new Error("JWT_SECRET is not configured");
  }
  const secret: jwt.Secret = secretEnv;

  const payload = {
    uuid,
    id,
    username,
    user_type,
    token_type: tokenType,
  };

  /* -------------------------------------------
     ⏱ SAFE EXPIRY RESOLUTION
  -------------------------------------------- */
  let finalExpiresIn: JwtExpiresIn;

  if (isJwtExpiresIn(expiresIn)) {

    // user provided valid expiry
    finalExpiresIn = expiresIn;
  } else {
    // fallback (default behaviour - 7 days for both access and session tokens)
    finalExpiresIn = "7d";
  }

  const signOptions: SignOptions = {
    expiresIn: finalExpiresIn,
  };

  const token = jwt.sign(payload, secret, signOptions);

  return {
    token,
    token_type: tokenType,
    expires_in: finalExpiresIn,
  };
};

/* =====================================================
   🔌 Fastify JWT Plugin
===================================================== */
export default fp(async (fastify) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  await fastify.register(fastifyJwt, { secret });

  fastify.decorate("authenticate", async function authenticate(request, reply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });
});
