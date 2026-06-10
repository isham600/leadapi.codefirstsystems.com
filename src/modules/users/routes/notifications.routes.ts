import type { FastifyInstance } from "fastify";
import { verifyJwt } from "../../Middleware/auth.Middleware.js";
import {
  getNotifications,
  markRead,
  markAllRead,
  clearNotifications,
} from "../controllers/notifications.controller.js";
import {
  getNotificationPrefs,
  updateNotificationPrefs,
} from "../controllers/notification-prefs.controller.js";

export default async function notificationsRoutes(app: FastifyInstance) {
  // Notification list
  app.get("/notifications",           { preHandler: verifyJwt }, getNotifications);
  app.put("/notifications/read-all",  { preHandler: verifyJwt }, markAllRead);
  app.delete("/notifications",        { preHandler: verifyJwt }, clearNotifications);
  app.put("/notifications/:id/read",  { preHandler: verifyJwt }, markRead);

  // Notification preferences
  app.get("/notification-prefs",      { preHandler: verifyJwt }, getNotificationPrefs);
  app.put("/notification-prefs",      { preHandler: verifyJwt }, updateNotificationPrefs);
}
