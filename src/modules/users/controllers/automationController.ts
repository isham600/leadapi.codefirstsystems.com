import {
  createAutomation,
  getAutomations,
  getAutomation,
  updateAutomationStatus,
  updateAutomation,
  deleteAutomation,
  duplicateAutomation,
  getAutomationLogs,
} from "../utils/automationService.js";

const getDb  = (req: any) => req.server.db;
const getUser = (req: any) => req.user?.username as string;

export const createAutomationController = async (req: any, reply: any) => {
  try {
    const id = await createAutomation(getDb(req), { ...req.body, username: getUser(req) });
    return reply.send({ success: true, id });
  } catch (e: any) {
    req.log.error(e);
    return reply.status(500).send({ success: false, message: "Failed to create automation" });
  }
};

export const getAutomationsController = async (req: any, reply: any) => {
  try {
    const result = await getAutomations(getDb(req), req.query, getUser(req));
    return reply.send({ success: true, automations: result.data, total: result.total });
  } catch (e: any) {
    req.log.error(e);
    return reply.status(500).send({ success: false, message: "Failed to fetch automations" });
  }
};

export const getAutomationController = async (req: any, reply: any) => {
  try {
    const row = await getAutomation(getDb(req), Number(req.params.id), getUser(req));
    if (!row) return reply.status(404).send({ success: false, message: "Automation not found" });
    return reply.send({ success: true, automation: row });
  } catch (e: any) {
    req.log.error(e);
    return reply.status(500).send({ success: false, message: "Failed to fetch automation" });
  }
};

export const updateAutomationController = async (req: any, reply: any) => {
  try {
    await updateAutomation(getDb(req), Number(req.params.id), getUser(req), req.body);
    return reply.send({ success: true, message: "Automation updated" });
  } catch (e: any) {
    req.log.error(e);
    return reply.status(e.statusCode ?? 500).send({ success: false, message: e.message || "Failed to update" });
  }
};

export const updateAutomationStatusController = async (req: any, reply: any) => {
  try {
    const { status } = req.body;
    if (!["active","paused","draft"].includes(status))
      return reply.status(400).send({ success: false, message: "Invalid status" });
    await updateAutomationStatus(getDb(req), Number(req.params.id), getUser(req), status);
    return reply.send({ success: true, message: "Status updated" });
  } catch (e: any) {
    req.log.error(e);
    return reply.status(e.statusCode ?? 500).send({ success: false, message: e.message });
  }
};

export const deleteAutomationController = async (req: any, reply: any) => {
  try {
    await deleteAutomation(getDb(req), Number(req.params.id), getUser(req));
    return reply.send({ success: true, message: "Automation deleted" });
  } catch (e: any) {
    req.log.error(e);
    return reply.status(e.statusCode ?? 500).send({ success: false, message: e.message });
  }
};

export const duplicateAutomationController = async (req: any, reply: any) => {
  try {
    const { name } = req.body;
    if (!name) return reply.status(400).send({ success: false, message: "Name is required" });
    const newId = await duplicateAutomation(getDb(req), Number(req.params.id), getUser(req), name);
    return reply.send({ success: true, id: newId, message: "Automation duplicated" });
  } catch (e: any) {
    req.log.error(e);
    return reply.status(e.statusCode ?? 500).send({ success: false, message: e.message });
  }
};

export const getAutomationLogsController = async (req: any, reply: any) => {
  try {
    const result = await getAutomationLogs(getDb(req), getUser(req), req.query);
    return reply.send({ success: true, logs: result.data, total: result.total });
  } catch (e: any) {
    req.log.error(e);
    return reply.status(500).send({ success: false, message: "Failed to fetch logs" });
  }
};
