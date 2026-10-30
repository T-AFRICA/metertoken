/**
 * DEVELOPMENT ONLY: registers a test tenant, so the tenant token page can be tried
 * without a staff login. PGlite allows one process at a time, so stop `npm run dev:api` first.
 *
 *   npx tsx --env-file=.env scripts/seed-dev-customer.ts [meterNo] [pin]
 */
import { hash } from '@node-rs/argon2';
import { loadConfig } from '../src/config';
import { migrate, openDb } from '../src/db';

const [meterNo = '01234567890', pin = '2468'] = process.argv.slice(2);

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production' || cfg.STS_MODE !== 'mock') throw new Error('Development (mock mode) only');

const db = await openDb({ databaseUrl: cfg.DATABASE_URL, pgliteDir: cfg.PGLITE_DIR });
await migrate(db);
const existing = (await db.query<{ id: string }>('SELECT id FROM customers WHERE meter_no = $1', [meterNo])).rows[0];
if (existing) {
  console.log(`A tenant is already registered on meter ${meterNo}`);
} else {
  await db.query(`INSERT INTO customers (meter_no, name, pin_hash, currency) VALUES ($1, 'Test Tenant (dev)', $2, $3)`, [meterNo, await hash(pin), cfg.CURRENCY]);
  console.log(`Test tenant registered on meter ${meterNo}`);
}
await db.close();
