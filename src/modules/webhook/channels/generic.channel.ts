import { webhookGenericQueue, type WebhookJobData } from "../../../queues/webhook.queue.js";

export async function dispatchGeneric(data: WebhookJobData): Promise<void> {
  await webhookGenericQueue.add(
    `generic-${data.uuid}-${Date.now()}`,
    data,
    { priority: 2 },
  );
}
