/**
 * DEVELOPMENT ONLY: registers a test customer with a starting balance, so the customer page can be tried
 * without a staff login. PGlite allows one process at a time, so stop `npm run dev:api` first.
 *
 *   npx tsx --env-file=.env scripts/seed-dev-customer.ts [meterNo] [pin] [balance]
 */
import { hash } from '@node-rs/argon2';
import { loadConfig } from '../src/config';
import { migrate, openDb } from '../src/db';

const [meterNo = '01234567890', pin = '2468', balance = '50000'] = process.argv.slice(2);

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production' || cfg.STS_MODE !== 'mock') throw new Error('Development (mock mode) only');

const db = await openDb({ databaseUrl: cfg.DATABASE_URL, pgliteDir: cfg.PGLITE_DIR });
await migrate(db);
await db.tx(async (q) => {
  const existing = (await q.query<{ id: string }>('SELECT id FROM customers WHERE meter_no = $1', [meterNo])).rows[0];
  const id =
    existing?.id ??
    (
      await q.query<{ id: string }>(
        `INSERT INTO customers (meter_no, name, pin_hash, currency) VALUES ($1, 'Test Customer (dev)', $2, $3) RETURNING id`,
        [meterNo, await hash(pin), cfg.CURRENCY],
      )
    ).rows[0]!.id;
  const after = (await q.query<{ balance: string }>('UPDATE customers SET balance = balance + $2 WHERE id = $1 RETURNING balance::text AS balance', [id, balance])).rows[0]!.balance;
  await q.query(`INSERT INTO customer_ledger (customer_id, kind, amount, balance_after, note) VALUES ($1, 'topup', $2, $3, 'Development seed')`, [id, balance, after]);
  console.log(`Test customer on meter ${meterNo}: balance ${after} ${cfg.CURRENCY}${existing ? ' (existing customer topped up)' : ''}`);
});
await db.close();
