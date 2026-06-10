import fp from 'fastify-plugin';
import { db } from '../models/db.js';
import { Kysely } from 'kysely';
import { DB } from '../models/schema.js';
import { setupDatabaseMonitoring } from '../utils/dbMonitoring.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<DB>;
  }
}

export default fp(async (fastify) => {
  try {
    // Test database connection on startup
    await (db as any)
      .selectFrom('users')
      .select(['uuid'])
      .limit(1)
      .executeTakeFirst();

    fastify.log.info('✓ Database connected successfully');
    fastify.decorate('db', db);

    // Setup database monitoring
    setupDatabaseMonitoring(fastify);

    // Add graceful shutdown hook
    fastify.addHook('onClose', async () => {
      fastify.log.info('Closing database connections...');
      try {
        await (db as any).destroy?.();
        fastify.log.info('✓ Database connections closed');
      } catch (err) {
        fastify.log.error({ err }, 'Error closing database:');
      }
    });

    // Setup pool error handlers
    const pool = (db as any).dialect?.pool;
    if (pool) {
      pool.on('error', (err: Error) => {
        fastify.log.error({ err }, '[DB Pool Error]');
      });

      pool.on('enqueue', () => {
        fastify.log.debug('[DB Pool] Connection requested but none available');
      });
    }
  } catch (err) {
    fastify.log.error({ err }, '✗ Failed to connect to database:');
    throw new Error('Database connection failed on startup');
  }
});
