import IORedis from "ioredis";

// ============================================================
// Redis Pub/Sub Publisher
// Workers (separate processes) call publishInboxEvent() to
// push real-time events to the WebSocket server process.
// Channel pattern:  inbox:{uuid}
// ============================================================

let publisher: IORedis | null = null;

function getPublisher(): IORedis {
  if (!publisher) {
    publisher = new IORedis({
      host:                 process.env.REDIS_HOST     ?? "127.0.0.1",
      port:                 Number(process.env.REDIS_PORT ?? 6379),
      password:             process.env.REDIS_PASSWORD ?? undefined,
      lazyConnect:          true,
      enableOfflineQueue:   true,
      maxRetriesPerRequest: null,
    });
    publisher.on("error", (err) =>
      console.error("[ws-publisher] Redis error:", err?.message),
    );
  }
  return publisher;
}

// Event shape published to Redis
export interface InboxEvent {
  type: "new_message" | "conversation_update" | "typing" | "read_ack";
  [key: string]: any;
}

export async function publishInboxEvent(
  uuid:  string,
  event: InboxEvent,
): Promise<void> {
  try {
    const pub     = getPublisher();
    const channel = `inbox:${uuid}`;
    await pub.publish(channel, JSON.stringify(event));
  } catch (err: any) {
    // Non-fatal — WebSocket is best-effort real-time enhancement
    console.error("[ws-publisher] publish failed:", err?.message);
  }
}
