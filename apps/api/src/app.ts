import cookie from '@fastify/cookie';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import type { AppContext } from './context';
import { HttpError } from './http';
import { adminRoutes } from './routes/admin';
import { authRoutes, registerSessionHooks } from './routes/auth';
import { customerRoutes } from './routes/customer';
import { customerAdminRoutes } from './routes/customers';
import { quoteRoutes } from './routes/quotes';
import { vendRoutes } from './routes/vends';

export const loggerOptions: FastifyServerOptions['logger'] = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers.authorization', 'res.headers["set-cookie"]'],
};

export async function buildApp(ctx: AppContext, opts: FastifyServerOptions = {}) {
  const app = Fastify({ trustProxy: true, bodyLimit: 64 * 1024, ...opts });
  await app.register(cookie);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-robots-tag', 'noindex, nofollow');
    reply.header('referrer-policy', 'same-origin');
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message, ...err.extra });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({ error: 'INVALID_INPUT', message: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input' });
    }
    const status = err.statusCode;
    if (status && status < 500) return reply.status(status).send({ error: 'BAD_REQUEST', message: err.message });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'INTERNAL', message: 'Something went wrong. The error was logged.' });
  });

  registerSessionHooks(app, ctx);
  app.get('/api/health', async () => ({ ok: true, adapterMode: ctx.adapter.mode }));
  authRoutes(app, ctx);
  quoteRoutes(app, ctx);
  vendRoutes(app, ctx);
  adminRoutes(app, ctx);
  customerRoutes(app, ctx);
  customerAdminRoutes(app, ctx);
  return app;
}
