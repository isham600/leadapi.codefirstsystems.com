import { FastifyInstance } from 'fastify';
import authRoutes from './routes/auth.routes.js';
import smppGatewayRoutes from './routes/smppGateway.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';

export default async function userModule(app: FastifyInstance) {
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(smppGatewayRoutes, { prefix: '/auth' });
  await app.register(notificationsRoutes, { prefix: '/auth' });
}
