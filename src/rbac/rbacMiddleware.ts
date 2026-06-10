// src/rbac/rbac.middleware.ts

import { FastifyRequest, FastifyReply } from "fastify";
import { ROLE } from "./roles.js";
import { canCreateRole } from "./rbacHelper.js";
 

 

const ROLE_MAP: Record<string, ROLE> = {
  super_admin: ROLE.SUPER_ADMIN,
  admin: ROLE.ADMIN,
  reseller: ROLE.RESELLER,
  user: ROLE.USER,
  agent: ROLE.AGENT,
};

export const rbacCreateUser =
  () => async (req: FastifyRequest, reply: FastifyReply) => {

    const actor = req.user as any;

    if (!actor?.user_type) {
      return reply.status(401).send({
        message: "Unauthorized",
      });
    }

    const creatorRole = actor.user_type as ROLE;

    // 🔥 FIX HERE
    const roleString = (req.body as any).role;
    const targetRole = ROLE_MAP[roleString ?? "user"];

    if (!targetRole) {
      return reply.status(400).send({
        message: "Invalid role",
      });
    }

    // if (!canCreateRole(creatorRole, targetRole)) {
    //   return reply.status(403).send({
    //     message: "You are not allowed to create this role",
    //   });
    // }
  };
