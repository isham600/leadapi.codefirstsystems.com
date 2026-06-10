export const createWorkflowSchema = {
  body: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      source: { type: "string" },
      trigger: { type: "string" },
    },
  },
};

export const getWorkflowsSchema = {
  querystring: {
    type: "object",
    properties: {
      page: { type: "number", default: 1 },
      limit: { type: "number", default: 10 },
      search: { type: "string" },
      status: { type: "string" },
    },
  },
};
