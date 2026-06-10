
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      uuid: string;
      id?: number;
      email?: string;
      username?: string;
      iat?: number;
      exp?: number;
    };
    session?: any;
    webhookUser?: {
      uuid: string;
      username: string;
    };
  }

  interface FastifyInstance {
    wsBroadcast(uuid: string, event: object): void;
  }
}
