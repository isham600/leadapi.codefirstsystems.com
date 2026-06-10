export async function createWorkflow(db: any, data: any) {
  const { name, description, source, trigger, username } = data;

  const result = await db
    .insertInto("chatbot_summary")
    .values({
      username,
      name,
      description: description || null,
      source: source || "Any",
      trigger_event: trigger || "New Lead",
      status: "draft",
      runs: 0,
      last_run: null,
    })
    .executeTakeFirst();

  return Number(result.insertId);
}

export async function getWorkflows(db: any, filters: any, username: string) {
  const page = Number(filters.page || 1);
  const limit = Number(filters.limit || 10);
  const search = filters.search || "";
  const status = filters.status;

  let query = db
    .selectFrom("chatbot_summary")
    .selectAll()
    .where("username", "=", username) // 🔐 user isolation
    .orderBy("created_at", "desc");

  if (search) {
    query = query.where((eb: any) =>
      eb.or([
        eb("name", "like", `%${search}%`),
        eb("source", "like", `%${search}%`),
        eb("trigger_event", "like", `%${search}%`),
      ]),
    );
  }

  if (status && status !== "all") {
    query = query.where("status", "=", status);
  }

  const workflows = await query
    .limit(limit)
    .offset((page - 1) * limit)
    .execute();

  // total count with SAME filters
  let countQuery = db
    .selectFrom("chatbot_summary")
    .select((eb: any) => eb.fn.count("id").as("total"))
    .where("username", "=", username);

  if (search) {
    countQuery = countQuery.where((eb: any) =>
      eb.or([
        eb("name", "like", `%${search}%`),
        eb("source", "like", `%${search}%`),
        eb("trigger_event", "like", `%${search}%`),
      ]),
    );
  }

  if (status && status !== "all") {
    countQuery = countQuery.where("status", "=", status);
  }

  const countResult = await countQuery.executeTakeFirst();

  return {
    data: workflows,
    total: Number(countResult?.total || 0),
  };
}

export async function saveWorkflowCanvas(
  db: any,
  chatbotId: number,
  username: string,
  nodes: any,
  edges: any,
) {
  // 🔐 Verify workflow belongs to user
  const workflow = await db
    .selectFrom("chatbot_summary")
    .select(["id"])
    .where("id", "=", chatbotId)
    .where("username", "=", username)
    .executeTakeFirst();

  if (!workflow) {
    throw new Error("Workflow not found or unauthorized");
  }

  const existing = await db
    .selectFrom("chatbot_detail")
    .select(["id"])
    .where("chatbot_id", "=", chatbotId)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable("chatbot_detail")
      .set({
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
      })
      .where("chatbot_id", "=", chatbotId)
      .execute();
  } else {
    await db
      .insertInto("chatbot_detail")
      .values({
        chatbot_id: chatbotId,
        username,
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
      })
      .execute();
  }
}

export async function getWorkflowCanvas(
  db: any,
  chatbotId: number,
  username: string,
) {
  const result = await db
    .selectFrom("chatbot_detail")
    .innerJoin(
      "chatbot_summary",
      "chatbot_summary.id",
      "chatbot_detail.chatbot_id",
    )
    .select(["chatbot_detail.nodes", "chatbot_detail.edges"])
    .where("chatbot_detail.chatbot_id", "=", chatbotId)
    .where("chatbot_summary.username", "=", username)
    .executeTakeFirst();

  return result;
}

export async function updateWorkflowStatus(
  db: any,
  chatbotId: number,
  username: string,
  status: "active" | "paused",
) {
  const workflow = await db
    .selectFrom("chatbot_summary")
    .select(["id"])
    .where("id", "=", chatbotId)
    .where("username", "=", username)
    .executeTakeFirst();

  if (!workflow) {
    throw new Error("Workflow not found or unauthorized");
  }

  await db
    .updateTable("chatbot_summary")
    .set({
      status,
      updated_at: new Date(),
    })
    .where("id", "=", chatbotId)
    .execute();

  return true;
}

export async function deleteWorkflow(
  db: any,
  chatbotId: number,
  username: string,
) {
  const result = await db
    .deleteFrom("chatbot_summary")
    .where("id", "=", chatbotId)
    .where("username", "=", username)
    .executeTakeFirst();

  return result;
}

export async function duplicateWorkflow(
  db: any,
  chatbotId: number,
  username: string,
  newName: string,
) {
  // Get original workflow
  const workflow = await db
    .selectFrom("chatbot_summary")
    .selectAll()
    .where("id", "=", chatbotId)
    .where("username", "=", username)
    .executeTakeFirst();

  if (!workflow) {
    throw new Error("Workflow not found");
  }

  // Create new summary
  const insertResult = await db
    .insertInto("chatbot_summary")
    .values({
      username,
      name: newName,
      description: workflow.description,
      source: workflow.source,
      trigger_event: workflow.trigger_event,
      status: "draft",
      runs: 0,
      last_run: null,
    })
    .executeTakeFirst();

  const newChatbotId = Number(insertResult.insertId);

  // Copy canvas
  const detail = await db
    .selectFrom("chatbot_detail")
    .selectAll()
    .where("chatbot_id", "=", chatbotId)
    .executeTakeFirst();

  if (detail) {
    await db
      .insertInto("chatbot_detail")
      .values({
        chatbot_id: newChatbotId,
        username,
        nodes: detail.nodes,
        edges: detail.edges,
      })
      .execute();
  }

  return newChatbotId;
}