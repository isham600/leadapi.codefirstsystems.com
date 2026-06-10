import { webhookChatbotQueue, type WebhookJobData } from "../../../queues/webhook.queue.js";

export async function dispatchChatbot(data: WebhookJobData): Promise<void> {
  await webhookChatbotQueue.add(
    `chatbot-${data.uuid}-${Date.now()}`,
    data,
    { priority: 1 },
  );
}
