import { webhookFacebookQueue, type WebhookJobData } from "../../../queues/webhook.queue.js";

export async function dispatchFacebook(data: WebhookJobData): Promise<void> {
  await webhookFacebookQueue.add(
    `facebook-${data.uuid}-${Date.now()}`,
    data,
    { priority: 1 },
  );
}
