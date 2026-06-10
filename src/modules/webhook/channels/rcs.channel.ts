import { webhookRcsQueue, type WebhookJobData } from "../../../queues/webhook.queue.js";

export async function dispatchRcs(data: WebhookJobData): Promise<void> {
  await webhookRcsQueue.add(
    `rcs-${data.uuid}-${Date.now()}`,
    data,
    { priority: 1 },
  );
}
