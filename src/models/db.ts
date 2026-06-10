import { Kysely, MysqlDialect } from 'kysely';
import mysql from 'mysql2';
import { DB } from './schema.js';
import { config } from 'dotenv';

config(); // Load .env

export const db = new Kysely<DB>({
  dialect: new MysqlDialect({
    pool: mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 50,          // Reduced from 300 to reasonable default
      queueLimit: 0,                // No limit on queued connections
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000, // Keep-alive probe every 10s
    }),
  }),
});
