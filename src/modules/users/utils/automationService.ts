export async function createAutomation(db: any, data: any) {
  const { name, description, source, trigger, triggerType, keywordMatch, username } = data;
  const result = await db
    .insertInto("automation_summary")
    .values({
      username,
      name,
      description:   description   || null,
      source:        source        || "Any",
      trigger_event: trigger       || "New Lead",
      trigger_type:  triggerType   || "event",
      keyword_match: keywordMatch  || null,
      actions_json:  null,
      status:        "draft",
      runs:          0,
      last_run:      null,
    })
    .executeTakeFirst();
  return Number(result.insertId);
}

export async function getAutomations(db: any, filters: any, username: string) {
  const page    = Number(filters.page   || 1);
  const limit   = Number(filters.limit  || 20);
  const search  = filters.search        || "";
  const status  = filters.status;
  const ttype   = filters.trigger_type;

  let q = db
    .selectFrom("automation_summary")
    .selectAll()
    .where("username", "=", username)
    .orderBy("created_at", "desc");

  if (search) {
    q = q.where((eb: any) =>
      eb.or([
        eb("name",          "like", `%${search}%`),
        eb("source",        "like", `%${search}%`),
        eb("trigger_event", "like", `%${search}%`),
        eb("description",   "like", `%${search}%`),
      ])
    );
  }
  if (status && status !== "all") q = q.where("status", "=", status);
  if (ttype  && ttype  !== "all") q = q.where("trigger_type", "=", ttype);

  const [rows, countRow] = await Promise.all([
    q.limit(limit).offset((page - 1) * limit).execute(),
    (() => {
      let cq = db
        .selectFrom("automation_summary")
        .select((eb: any) => eb.fn.count("id").as("total"))
        .where("username", "=", username);
      if (search) cq = cq.where((eb: any) => eb.or([eb("name","like",`%${search}%`),eb("source","like",`%${search}%`),eb("trigger_event","like",`%${search}%`)]));
      if (status && status !== "all") cq = cq.where("status", "=", status);
      if (ttype  && ttype  !== "all") cq = cq.where("trigger_type", "=", ttype);
      return cq.executeTakeFirst();
    })(),
  ]);

  return { data: rows, total: Number(countRow?.total || 0) };
}

export async function getAutomation(db: any, id: number, username: string) {
  return db
    .selectFrom("automation_summary")
    .selectAll()
    .where("id",       "=", id)
    .where("username", "=", username)
    .executeTakeFirst();
}

export async function updateAutomationStatus(
  db: any, id: number, username: string, status: "active" | "paused" | "draft",
) {
  const row = await getAutomation(db, id, username);
  if (!row) throw Object.assign(new Error("Automation not found"), { statusCode: 404 });
  await db.updateTable("automation_summary")
    .set({ status, updated_at: new Date() })
    .where("id", "=", id)
    .execute();
  return true;
}

export async function updateAutomation(db: any, id: number, username: string, data: any) {
  const row = await getAutomation(db, id, username);
  if (!row) throw Object.assign(new Error("Automation not found"), { statusCode: 404 });
  const { name, description, source, trigger, triggerType, keywordMatch, actions } = data;
  await db.updateTable("automation_summary")
    .set({
      ...(name         !== undefined && { name }),
      ...(description  !== undefined && { description }),
      ...(source       !== undefined && { source }),
      ...(trigger      !== undefined && { trigger_event:  trigger }),
      ...(triggerType  !== undefined && { trigger_type:   triggerType }),
      ...(keywordMatch !== undefined && { keyword_match:  keywordMatch || null }),
      ...(actions      !== undefined && { actions_json:   JSON.stringify(actions) }),
      updated_at: new Date(),
    })
    .where("id", "=", id)
    .execute();
  return true;
}

export async function deleteAutomation(db: any, id: number, username: string) {
  const row = await getAutomation(db, id, username);
  if (!row) throw Object.assign(new Error("Automation not found"), { statusCode: 404 });
  await db.deleteFrom("automation_summary").where("id","=",id).where("username","=",username).execute();
  return true;
}

export async function duplicateAutomation(db: any, id: number, username: string, newName: string) {
  const row = await getAutomation(db, id, username);
  if (!row) throw Object.assign(new Error("Automation not found"), { statusCode: 404 });
  const result = await db.insertInto("automation_summary").values({
    username,
    name:          newName,
    description:   row.description,
    source:        row.source,
    trigger_event: row.trigger_event,
    trigger_type:  row.trigger_type,
    actions_json:  row.actions_json,
    status:        "draft",
    runs:          0,
    last_run:      null,
  }).executeTakeFirst();
  return Number(result.insertId);
}

export async function getAutomationLogs(db: any, username: string, filters: any) {
  const page  = Number(filters.page  || 1);
  const limit = Number(filters.limit || 20);
  let q = db
    .selectFrom("automation_logs")
    .selectAll()
    .where("username", "=", username)
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset((page - 1) * limit);

  if (filters.automation_id) q = q.where("automation_id", "=", Number(filters.automation_id));
  if (filters.result) q = q.where("result", "=", filters.result);

  const [rows, countRow] = await Promise.all([
    q.execute(),
    db.selectFrom("automation_logs")
      .select((eb: any) => eb.fn.count("id").as("total"))
      .where("username", "=", username)
      .executeTakeFirst(),
  ]);
  return { data: rows, total: Number(countRow?.total || 0) };
}

export async function addAutomationLog(
  db: any,
  entry: { automation_id: number; username: string; automation_name: string; event: string; result: "success"|"failed"|"skipped"; error_message?: string }
) {
  await db.insertInto("automation_logs").values({ ...entry, created_at: new Date() }).execute();
}
