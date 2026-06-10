import { webhookWhatsappQueue, type WebhookJobData } from "../../../queues/webhook.queue.js";

export async function dispatchWhatsapp(data: WebhookJobData): Promise<void> {
  await webhookWhatsappQueue.add(
    `whatsapp-${data.uuid}-${Date.now()}`,
    data,
    { priority: 1 },
  );
}
