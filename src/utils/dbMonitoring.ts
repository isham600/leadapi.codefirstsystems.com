import type { FastifyInstance } from 'fastify';
import { db } from '../models/db.js';

let queryCount = 0;
let slowQueryCount = 0;

interface QueryMetrics {
  totalQueries: number;
  slowQueries: number;
  lastSlowQuery?: {
    sql: string;
    duration: number;
    timestamp: string;
  };
}

export const dbMetrics: QueryMetrics = {
  totalQueries: 0,
  slowQueries: 0,
};

export const setupDatabaseMonitoring = (fastify: FastifyInstance) => {
  fastify.log.info('✓ Database monitoring initialized');

  // Setup slow query logging
  const originalExecuteQuery = (db as any).executeQuery.bind(db);
  (db as any).executeQuery = async (compiledQuery: any) => {
    const startTime = performance.now();
    queryCount++;
    dbMetrics.totalQueries++;

    try {
      const result = await originalExecuteQuery(compiledQuery);
      const duration = performance.now() - startTime;

      if (duration > 1000) {
        slowQueryCount++;
        dbMetrics.slowQueries++;
        dbMetrics.lastSlowQuery = {
          sql: compiledQuery.sql?.substring(0, 200) || 'Unknown',
          duration: Math.round(duration),
          timestamp: new Date().toISOString(),
        };
        fastify.log.warn(
          `[SLOW QUERY] ${Math.round(duration)}ms: ${compiledQuery.sql?.substring(0, 100)}...`
        );
      }

      return result;
    } catch (err) {
      const duration = performance.now() - startTime;
      fastify.log.error(
        `[QUERY ERROR] ${Math.round(duration)}ms: ${(err as Error).message}`
      );
      throw err;
    }
  };
};

export const getDbMetrics = (): QueryMetrics => {
  return {
    totalQueries: dbMetrics.totalQueries,
    slowQueries: dbMetrics.slowQueries,
    lastSlowQuery: dbMetrics.lastSlowQuery,
  };
};

export const resetDbMetrics = () => {
  dbMetrics.totalQueries = 0;
  dbMetrics.slowQueries = 0;
  dbMetrics.lastSlowQuery = undefined;
};
