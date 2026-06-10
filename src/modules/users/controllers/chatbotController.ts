import {
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  getWorkflowCanvas,
  getWorkflows,
  saveWorkflowCanvas,
  updateWorkflowStatus,
} from "../utils/chatbotService.js";

export const createWorkflowController = async (request: any, reply: any) => {
  try {
    const db = request.server.db;
    const username = request.user.username;

    const id = await createWorkflow(db, {
      ...request.body,
      username,
    });

    return reply.send({
      success: true,
      id,
    });
  } catch (error) {
    request.log.error(error);

    return reply.status(500).send({
      success: false,
      message: "Failed to create workflow",
    });
  }
};

export const getWorkflowsController = async (request: any, reply: any) => {
  try {
    const db = request.server.db;
    const username = request.user.username;

    const workflows = await getWorkflows(db, request.query, username);

    return reply.send({
      success: true,
      workflows: workflows.data,
      total: workflows.total,
    });
  } catch (error) {
    request.log.error(error);

    return reply.status(500).send({
      success: false,
      message: "Failed to fetch workflows",
    });
  }
};

export const saveWorkflowCanvasController = async (req: any, reply: any) => {
  try {
    const db = req.server.db;
    const username = req.user.username;
    const chatbotId = Number(req.params.id);

    const { nodes, edges } = req.body;

    await saveWorkflowCanvas(db, chatbotId, username, nodes, edges);

    return reply.send({
      success: true,
      message: "Workflow saved successfully",
    });
  } catch (error: any) {
    req.log.error(error);

    if (error.message === "Workflow not found or unauthorized") {
      return reply.status(404).send({
        success: false,
        message: error.message,
      });
    }

    return reply.status(500).send({
      success: false,
      message: "Failed to save workflow",
    });
  }
};

export const getWorkflowCanvasController = async (req: any, reply: any) => {
  try {
    const db = req.server.db;
    const username = req.user.username;
    const chatbotId = Number(req.params.id);

    const workflow = await getWorkflowCanvas(db, chatbotId, username);

    return reply.send({
      success: true,
      data: workflow
        ? {
            nodes: JSON.parse(workflow.nodes),
            edges: JSON.parse(workflow.edges),
          }
        : { nodes: [], edges: [] },
    });
  } catch (error) {
    req.log.error(error);

    return reply.status(500).send({
      success: false,
      message: "Failed to load workflow",
    });
  }
};

export const updateWorkflowStatusController = async (req: any, reply: any) => {
  try {
    const db = req.server.db;
    const username = req.user.username;
    const chatbotId = Number(req.params.id);

    const { status } = req.body;

    if (!["active", "paused"].includes(status)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid status",
      });
    }

    await updateWorkflowStatus(db, chatbotId, username, status);

    return reply.send({
      success: true,
      message: "Workflow status updated",
    });
  } catch (error: any) {
    req.log.error(error);

    return reply.status(500).send({
      success: false,
      message: error.message || "Failed to update status",
    });
  }
};

export const deleteWorkflowController = async (req: any, reply: any) => {
  try {
    const db = req.server.db;
    const username = req.user.username;
    const chatbotId = Number(req.params.id);

    await deleteWorkflow(db, chatbotId, username);

    return reply.send({
      success: true,
      message: "Workflow deleted successfully",
    });
  } catch (error) {
    req.log.error(error);

    return reply.status(500).send({
      success: false,
      message: "Failed to delete workflow",
    });
  }
};

export const duplicateWorkflowController = async (req: any, reply: any) => {
  try {
    const db = req.server.db;
    const username = req.user.username;
    const chatbotId = Number(req.params.id);

    const { name } = req.body;

    if (!name) {
      return reply.status(400).send({
        success: false,
        message: "Workflow name is required",
      });
    }

    const newId = await duplicateWorkflow(db, chatbotId, username, name);

    return reply.send({
      success: true,
      id: newId,
      message: "Workflow duplicated successfully",
    });
  } catch (error) {
    req.log.error(error);

    return reply.status(500).send({
      success: false,
      message: "Failed to duplicate workflow",
    });
  }
};
