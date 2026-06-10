// utils/check-duplicate.ts
import { db } from "../../../models/index.js";

export async function checkDuplicateLead(
  tenant_id: string,
  phone?: string,
  email?: string
) {
  if (!phone && !email) return null;

  return db
    .selectFrom("leads")
    .select(["id"])
    .where("tenant_id", "=", tenant_id)
    .where((eb) =>
      eb.or([
        phone ? eb("phone", "=", phone) : null,
        email ? eb("email", "=", email) : null,
      ].filter(Boolean))
    )
    .executeTakeFirst();
}
