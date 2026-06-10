import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import Redis from "ioredis";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import path from "path";

// ------------------------------
// Internal plugins
// ------------------------------
import config from "./plugins/config.js";
import sensible from "./plugins/sensible.js";
import mysql from "./plugins/db.js";
import jwtPlugin from "./plugins/jwt.js";
import websocketPlugin from "./plugins/websocket.plugin.js";
import { getDbMetrics } from "./utils/dbMonitoring.js";

// ------------------------------
// Modular routes
// ------------------------------
import registerUserModule     from "./modules/users/index.js";
import registerMetaModule     from "./modules/meta/index.js";
import registerWhatsappModule from "./modules/whatsapp/index.js";
import registerFormsModule    from "./modules/forms/index.js";
import registerGoogleModule   from "./modules/google/index.js";
import registerWebhookModule  from "./modules/webhook/index.js";
import registerBillingModule  from "./modules/billing/index.js";

// ======================================================
// Build Fastify Application (Modular + Configurable)
// ======================================================
export const buildApp = async () => {
  // --------------------------------------------
  // Fastify Instance with Logger + Body Limits
  // --------------------------------------------
  const app = Fastify({
    logger: {
      transport: {
        target: "pino-pretty",
        options: {
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
          colorize: true,
        },
      },
    },
    bodyLimit: 4 * 1024 * 1024 * 1024, // 4GB Request Size
  });

  // --------------------------------------------
  // Multipart handling (file uploads)
  // --------------------------------------------
  await app.register(multipart, {
    limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4GB per file
  });

  // --------------------------------------------
  // Swagger Documentation
  // --------------------------------------------
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Fastify API",
        version: "1.0.0",
      },
    },
  });

  await app.register(swaggerUI, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "full",
    },
  });

  // --------------------------------------------
  // Form-URL-Encoded Support
  // --------------------------------------------
  await app.register(formbody);

  // --------------------------------------------
  // Core Custom Plugins (ENV, Helpers, DB, JWT)
  // --------------------------------------------
  await app.register(config);     // Loads environment configs
  await app.register(sensible);   // Adds helpful utilities
  await app.register(mysql);      // DB Connection
  await app.register(jwtPlugin);  // JWT Auth

  // --------------------------------------------
  // CORS Setup (before WS plugin so upgrade requests are covered)
  // --------------------------------------------
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : false;

  await app.register(cors, {
    origin: allowedOrigins || true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  await app.register(websocketPlugin); // WebSocket + Redis pub/sub

  // --------------------------------------------
  // Cookie Support
  // --------------------------------------------
  const cookieSecret = process.env.COOKIE_SECRET;
  if (!cookieSecret) {
    throw new Error("COOKIE_SECRET environment variable is required");
  }

  await app.register(cookie, {
    secret: cookieSecret,
  });

  // --------------------------------------------
  // Static File Serving (Uploads)
  // --------------------------------------------
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), "uploads"),
    prefix: "/uploads/",
  });

  // Call recordings (uploaded by FreePBX AGI after call ends)
  const recordingsDir = process.env.RECORDINGS_DIR ?? path.join(process.cwd(), "recordings");
  await app.register(fastifyStatic, {
    root:        recordingsDir,
    prefix:      "/recordings/",
    decorateReply: false,
  });
  // Ensure directory exists
  await import("fs").then(fs => fs.mkdirSync(recordingsDir, { recursive: true }));

  // --------------------------------------------
  // OPTIONAL: Redis Rate Limiting (Disabled)
  // Uncomment when needed
  // --------------------------------------------

  /*
  const redis = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379", 10)
  });

  await app.register(rateLimit, {
    global: true,
    redis,
    max: 100,
    timeWindow: 1000,
    ban: 0,
    allowList: ["127.0.0.1"],
    keyGenerator: (req) => req.headers["x-api-key"] || req.ip,
    errorResponseBuilder: (req, context) => ({
      code: 429,
      message: `Too many requests. Limit is ${context.max} per second.`,
    }),
  });
  */

  // --------------------------------------------
  // Health Check & Metrics Endpoints
  // --------------------------------------------
  app.get('/health', async (request, reply) => {
    try {
      const result = await (app.db as any)
        .selectFrom('users')
        .select(['uuid'])
        .limit(1)
        .executeTakeFirst();

      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: result ? 'connected' : 'error',
        uptime: process.uptime(),
      });
    } catch (err) {
      return reply.status(503).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: (err as Error).message,
      });
    }
  });

  app.get('/metrics/db', async (request, reply) => {
    const metrics = getDbMetrics();
    return reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      metrics,
    });
  });

  // --------------------------------------------
  // Route Registration
  // --------------------------------------------
  await app.register(registerUserModule,     { prefix: "/api/users"      });
  await app.register(registerMetaModule,     { prefix: "/api/meta"       });
  await app.register(registerWhatsappModule, { prefix: "/api/whatsapp"   });
  await app.register(registerFormsModule,    { prefix: "/api/forms"      });
  await app.register(registerGoogleModule,   { prefix: "/api/google"     });
  await app.register(registerWebhookModule,  { prefix: "/api/webhook"    });
  await app.register(registerBillingModule,  { prefix: "/api"            });

  // Return fully built Fastify instance
  return app;
};