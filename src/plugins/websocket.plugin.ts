import fp from "fastify-plugin";
import fastifyWs from "@fastify/websocket";
import IORedis from "ioredis";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";

// ============================================================
// WebSocket plugin
// Route: GET /api/ws?token=<JWT>
//
// Flow:
//   1. Client connects with JWT token
//   2. Server verifies JWT → extracts uuid + username
//   3. Server subscribes client to inbox:{uuid} Redis channel
//   4. On Redis message → broadcast JSON to all open WS clients
//      for that uuid
//   5. On disconnect → remove from registry
// ============================================================

// uuid → Set of open WebSocket connections
const registry = new Map<string, Set<WebSocket>>();

// Broadcast a raw string to all clients for a given uuid
function broadcast(uuid: string, message: string): void {
  const clients = registry.get(uuid);
  if (!clients) return;
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(message);
    }
  }
}

export default fp(async (app: FastifyInstance) => {
  // ── Register @fastify/websocket ──────────────────────────
  await app.register(fastifyWs);

  // ── Redis subscriber (dedicated connection per spec) ─────
  const subscriber = new IORedis({
    host:                 process.env.REDIS_HOST     ?? "127.0.0.1",
    port:                 Number(process.env.REDIS_PORT ?? 6379),
    password:             process.env.REDIS_PASSWORD ?? undefined,
    lazyConnect:          false,
    maxRetriesPerRequest: null,
  });

  // Subscribe to all inbox channels using pattern
  await subscriber.psubscribe("inbox:*");

  subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
    // channel = "inbox:{uuid}"
    const uuid = channel.slice(6); // strip "inbox:"
    broadcast(uuid, message);
  });

  subscriber.on("error", (err) =>
    console.error("[ws-plugin] Redis subscriber error:", err?.message),
  );

  // ── WebSocket route ──────────────────────────────────────
  app.get("/api/ws", { websocket: true }, (socket: WebSocket, req: any) => {
    let uuid: string | null     = null;
    let username: string | null = null;

    // --- Authenticate via token query param or Authorization header ---
    const rawToken =
      (req.query as any)?.token as string | undefined
      ?? (req.headers?.authorization as string | undefined)?.replace(/^Bearer\s+/i, "");

    if (!rawToken) {
      socket.close(4001, "Missing token");
      return;
    }

    try {
      // Use Fastify JWT to verify (registered by jwtPlugin in app.ts)
      const decoded = (app as any).jwt.verify(rawToken) as any;
      uuid     = decoded?.uuid     ?? decoded?.id     ?? null;
      username = decoded?.username ?? decoded?.sub     ?? null;
    } catch {
      socket.close(4002, "Invalid token");
      return;
    }

    if (!uuid) {
      socket.close(4003, "Token missing uuid");
      return;
    }

    // --- Register client ---
    if (!registry.has(uuid)) registry.set(uuid, new Set());
    registry.get(uuid)!.add(socket);

    console.log(`[ws] client connected: uuid=${uuid} username=${username} total=${registry.get(uuid)!.size}`);

    // Send welcome ping
    socket.send(JSON.stringify({ type: "connected", uuid, username }));

    // --- Handle client pings (keep-alive) ---
    socket.on("message", (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === "ping") {
          socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        }
      } catch { /* ignore non-JSON */ }
    });

    // --- Cleanup on disconnect ---
    socket.on("close", () => {
      if (uuid) {
        const clients = registry.get(uuid);
        if (clients) {
          clients.delete(socket);
          if (clients.size === 0) registry.delete(uuid);
        }
      }
      console.log(`[ws] client disconnected: uuid=${uuid}`);
    });

    socket.on("error", (err: any) =>
      console.error(`[ws] socket error uuid=${uuid}:`, err?.message),
    );
  });

  // ── Expose broadcast for server-side push (send message, resolve, etc.) ──
  app.decorate("wsBroadcast", (uuid: string, event: object) => {
    broadcast(uuid, JSON.stringify(event));
  });

  app.addHook("onClose", async () => {
    subscriber.disconnect();
  });
}, { name: "websocket-plugin" });
