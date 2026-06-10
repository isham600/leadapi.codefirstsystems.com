import { webhookGoogleQueue, type WebhookJobData } from "../../../queues/webhook.queue.js";

export async function dispatchGoogle(data: WebhookJobData): Promise<void> {
  await webhookGoogleQueue.add(
    `google-${data.uuid}-${Date.now()}`,
    data,
    { priority: 1 },
  );
}
