import fp from 'fastify-plugin';
import fastifyEnv from '@fastify/env';

export default fp(async (fastify) => {
  await fastify.register(fastifyEnv, {
    schema: {
      type: 'object',
      required: ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'],
      properties: {
        MYSQL_HOST: { type: 'string' },
        MYSQL_PORT: { type: 'string' },
        MYSQL_USER: { type: 'string' },
        MYSQL_PASSWORD: { type: 'string' },
        MYSQL_DATABASE: { type: 'string' },
      },
    },
    dotenv: true,
  });
});
