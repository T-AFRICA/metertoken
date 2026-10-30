import { mkdirSync } from 'node:fs';
import Fastify from 'fastify';
import { createAdapter } from './adapter';
import { buildApp, loggerOptions } from './app';
import { bootstrap } from './bootstrap';
import { loadConfig } from './config';
import { migrate, openDb } from './db';
import { sweepUnknownVends } from './services/vends';

const SWEEP_INTERVAL_MS = 60_000;

const cfg = loadConfig();
const log = Fastify({ logger: loggerOptions }).log;
if (!cfg.DATABASE_URL) mkdirSync(cfg.PGLITE_DIR, { recursive: true });

const db = await openDb({ databaseUrl: cfg.DATABASE_URL, pgliteDir: cfg.PGLITE_DIR });
const applied = await migrate(db);
if (applied.length) log.info({ applied }, 'database migrations applied');
await bootstrap(cfg, db, log);

const adapter = await createAdapter(cfg, db, log);
const ctx = { cfg, db, adapter };
const app = await buildApp(ctx, { logger: loggerOptions });
log.warn(`STS adapter mode: ${adapter.mode.toUpperCase()}${adapter.mode === 'mock' ? ' (tokens are NOT valid on real meters)' : ''}`);

const timer = setInterval(() => {
  sweepUnknownVends(ctx).catch((err) => app.log.error({ err }, 'unknown-vend sweep failed'));
}, SWEEP_INTERVAL_MS);

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: cfg.HOST, port: cfg.PORT });
