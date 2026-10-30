import { randomBytes, randomUUID } from 'node:crypto';
import { MockStsAdapter } from '@tronic/core';
import Decimal from 'decimal.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { bootstrap } from '../src/bootstrap';
import { configSchema } from '../src/config';
import { migrate, openDb, type Db } from '../src/db';
import { sweepUnknownVends } from '../src/services/vends';
import type { AppContext } from '../src/context';

// Test-only credentials for an in-memory database.
const ADMIN_PW = 'test-admin-password';
const cfg = configSchema.parse({
  NODE_ENV: 'test',
  TOKEN_ENC_KEY: randomBytes(32).toString('base64'),
  BOOTSTRAP_ADMIN_USERNAME: 'admin',
  BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PW,
  SEED_SAMPLE_TARIFF: 'true',
  UNKNOWN_TO_REVIEW_SECONDS: '1',
});

let db: Db;
let app: FastifyInstance;
let ctx: AppContext;
const silentLog = { warn() {}, info() {}, error() {} } as never;

interface Session {
  cookie: string;
  csrf: string;
}

async function login(username: string, password: string): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  return { cookie, csrf: res.json().csrfToken };
}

const call = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, ...headers } });

async function quote(s: Session, meterNo: string, value = '5', mode: 'units' | 'amount' = 'units') {
  const res = await call(s, 'POST', '/api/quotes', { meterNo, mode, value });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const vend = (s: Session, quoteId: string, key = randomUUID(), extra: object = {}) =>
  call(s, 'POST', '/api/vends', { quoteId, ...extra }, { 'idempotency-key': key });

let admin: Session;
let cashier: Session;
let supervisor: Session;

beforeAll(async () => {
  db = await openDb({});
  await migrate(db);
  await bootstrap(cfg, db, silentLog);
  ctx = { cfg, db, adapter: new MockStsAdapter() };
  app = await buildApp(ctx);
  admin = await login('admin', ADMIN_PW);
  for (const [username, role] of [['cash1', 'cashier'], ['sup1', 'supervisor'], ['aud1', 'auditor'], ['admin2', 'admin']]) {
    const r = await call(admin, 'POST', '/api/admin/users', { username, displayName: username, role, password: `${username}-password` });
    expect(r.statusCode, r.body).toBe(200);
  }
  cashier = await login('cash1', 'cash1-password');
  supervisor = await login('sup1', 'sup1-password');
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('auth', () => {
  it('rejects wrong passwords and locks after repeated failures', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'aud1', password: 'wrong-password' } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'aud1', password: 'aud1-password' } });
    expect(locked.statusCode).toBe(429);
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/meters/verify', payload: { meterNo: '01234567890' }, headers: { cookie: cashier.cookie } });
    expect(r.statusCode).toBe(403);
  });

  it('enforces roles', async () => {
    expect((await call(cashier, 'GET', '/api/admin/users')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/vends' })).statusCode).toBe(401);
  });
});

describe('vending (mock adapter)', () => {
  it('verifies meters', async () => {
    expect((await call(cashier, 'POST', '/api/meters/verify', { meterNo: '01234567890' })).statusCode).toBe(200);
    expect((await call(cashier, 'POST', '/api/meters/verify', { meterNo: '00001234567' })).statusCode).toBe(404);
    expect((await call(cashier, 'POST', '/api/meters/verify', { meterNo: '123' })).statusCode).toBe(400);
  });

  it('quotes on the server and vends a mock token', async () => {
    const q = await quote(cashier, '11111111111');
    expect(q.amount).toBe('1781.20');
    const r = await vend(cashier, q.quoteId);
    expect(r.statusCode, r.body).toBe(200);
    const v = r.json();
    expect(v.status).toBe('SUCCEEDED');
    expect(v.adapterMode).toBe('mock');
    expect(v.tokens[0]).toMatch(/^MOCK /);
  });

  it('replays the same Idempotency-Key without a second token', async () => {
    const q = await quote(cashier, '22222222222');
    const key = randomUUID();
    const first = (await vend(cashier, q.quoteId, key)).json();
    const second = (await vend(cashier, q.quoteId, key)).json();
    expect(second.id).toBe(first.id);
    expect(second.tokens).toEqual(first.tokens);
    const count = (await db.query(`SELECT count(*)::int AS n FROM vends WHERE meter_no = '22222222222'`)).rows[0].n;
    expect(count).toBe(1);
  });

  it('does not allow a quote to be used twice', async () => {
    const q = await quote(cashier, '33333333333');
    await vend(cashier, q.quoteId);
    const again = await vend(cashier, q.quoteId);
    expect(again.json().error).toBe('QUOTE_USED');
  });

  it('blocks a second vend for the same meter within the cooldown', async () => {
    const q = await quote(cashier, '11111111111', '1');
    const r = await vend(cashier, q.quoteId);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('METER_COOLDOWN');
  });

  it('marks vendor rejections as FAILED', async () => {
    const q = await quote(cashier, '12345679999');
    expect((await vend(cashier, q.quoteId)).json().status).toBe('FAILED');
  });

  it('marks timeouts as UNKNOWN, blocks the meter, and lets a supervisor resolve it', async () => {
    const q = await quote(cashier, '12345678888');
    const v = (await vend(cashier, q.quoteId)).json();
    expect(v.status).toBe('UNKNOWN');
    expect(v.tokens).toBeNull();

    // Cooldown and the open-vend lock both stop a re-vend.
    const q2 = await quote(cashier, '12345678888', '2');
    expect((await vend(cashier, q2.quoteId)).statusCode).toBe(409);

    expect((await call(cashier, 'POST', `/api/vends/${v.id}/resolve`, { outcome: 'FAILED', note: 'checked vendor history' })).statusCode).toBe(403);
    const resolved = await call(supervisor, 'POST', `/api/vends/${v.id}/resolve`, { outcome: 'FAILED', note: 'Not in vendor history' });
    expect(resolved.json().status).toBe('FAILED');
  });

  it('recovers a timed-out vend whose token was issued, via the background sweep', async () => {
    const q = await quote(cashier, '12345676666');
    const v = (await vend(cashier, q.quoteId)).json();
    expect(v.status).toBe('UNKNOWN');
    await sweepUnknownVends(ctx);
    const after = (await call(supervisor, 'GET', `/api/vends/${v.id}`)).json();
    expect(after.status).toBe('SUCCEEDED');
    expect(after.tokens[0]).toMatch(/^MOCK /);
  });

  it('hides other cashiers’ transactions and never exports tokens', async () => {
    const list = (await call(cashier, 'GET', '/api/vends')).json();
    expect(list.items.length).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    const csv = (await call(supervisor, 'GET', `/api/admin/reports/export.csv?from=${today}&to=${today}`)).body;
    expect(csv).toContain('token_last4');
    expect(csv).not.toMatch(/MOCK \d{4}/);
  });
});

describe('admin', () => {
  it('requires a second admin to approve a tariff version', async () => {
    const draft = await call(admin, 'POST', '/api/admin/tariffs/DEFAULT/versions', {
      baseRate: '300',
      percentCharges: [{ name: 'VAT', percent: '18' }],
      fixedCharges: [],
    });
    const id = draft.json().id;
    expect((await call(admin, 'POST', `/api/admin/tariff-versions/${id}/approve`)).statusCode).toBe(403);
    const admin2 = await login('admin2', 'admin2-password');
    expect((await call(admin2, 'POST', `/api/admin/tariff-versions/${id}/approve`)).statusCode).toBe(200);
    const q = await quote(cashier, '44444444444', '1');
    expect(q.amount).toBe('354.00');
  });

  it('keeps an intact audit hash chain without secrets', async () => {
    const res = (await call(admin, 'GET', '/api/admin/audit/verify')).json();
    expect(res.ok).toBe(true);
    expect(res.checked).toBeGreaterThan(10);
    const all = (await db.query('SELECT payload FROM audit_events')).rows.map((r) => r.payload).join('\n');
    expect(all).not.toContain(ADMIN_PW);
    expect(all).not.toMatch(/MOCK \d{4} \d{4}/);
  });
});

describe('customer self-service', () => {
  interface CustomerSession {
    cookie: string;
    csrf: string;
  }

  async function register(meterNo: string, pin = '4321') {
    const r = await call(supervisor, 'POST', '/api/customers', { meterNo, name: `Customer ${meterNo.slice(-4)}`, pin });
    expect(r.statusCode, r.body).toBe(200);
    return r.json().id as string;
  }

  async function customerLogin(meterNo: string, pin = '4321'): Promise<CustomerSession> {
    const res = await app.inject({ method: 'POST', url: '/api/customer/login', payload: { meterNo, pin } });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: String(res.headers['set-cookie']).split(';')[0]!, csrf: res.json().csrfToken };
  }

  const ccall = (s: CustomerSession, method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, payload, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, ...headers } });

  async function buy(s: CustomerSession, value: string) {
    const q = await ccall(s, 'POST', '/api/customer/quotes', { mode: 'units', value });
    expect(q.statusCode, q.body).toBe(200);
    const r = await ccall(s, 'POST', '/api/customer/vends', { quoteId: q.json().quoteId }, { 'idempotency-key': randomUUID() });
    return { quote: q.json(), res: r };
  }

  it('lets only supervisors register, and only real meters', async () => {
    expect((await call(cashier, 'POST', '/api/customers', { meterNo: '55555555555', name: 'X', pin: '1234' })).statusCode).toBe(403);
    expect((await call(supervisor, 'POST', '/api/customers', { meterNo: '00001234567', name: 'X', pin: '1234' })).statusCode).toBe(404);
    expect((await call(supervisor, 'POST', '/api/customers', { meterNo: '55555555555', name: 'X', pin: '12' })).statusCode).toBe(400);
  });

  it('signs in with meter and PIN, and locks after repeated wrong PINs', async () => {
    await register('55555551111');
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/customer/login', payload: { meterNo: '55555551111', pin: '0000' } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: 'POST', url: '/api/customer/login', payload: { meterNo: '55555551111', pin: '4321' } });
    expect(locked.statusCode).toBe(429);
  });

  it('generates a token for the customer’s own meter and keeps it on their record', async () => {
    const id = await register('55555555555');
    const s = await customerLogin('55555555555');
    const { quote, res } = await buy(s, '2');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.vend.status).toBe('SUCCEEDED');
    expect(body.vend.tokens[0]).toMatch(/^MOCK /);
    expect(body.vend.meterNo).toBe('55555555555');

    const list = (await ccall(s, 'GET', '/api/customer/vends')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].tokenLast4).toBeTruthy();
    // Staff see the token under the self-service account and on the customer's record.
    const staff = (await call(supervisor, 'GET', `/api/vends/${body.vend.id}`)).json();
    expect(staff.operator).toBe('Tenant self-service');
    const record = (await call(cashier, 'GET', `/api/customers/${id}/vends`)).json();
    expect(record.items[0].id).toBe(body.vend.id);
    expect(record.month.count).toBe(1);
    expect(record.month.amount).toBe(new Decimal(quote.amount).toFixed(2));
  });

  it('blocks a deactivated customer', async () => {
    const id = await register('55555559999');
    const s = await customerLogin('55555559999');
    expect((await call(supervisor, 'PATCH', `/api/customers/${id}`, { active: false })).statusCode).toBe(200);
    expect((await ccall(s, 'GET', '/api/customer/me')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/customer/login', payload: { meterNo: '55555559999', pin: '4321' } })).statusCode).toBe(401);
    await call(supervisor, 'PATCH', `/api/customers/${id}`, { active: true });
  });

  it('keeps customers to their own meter and needs their CSRF token', async () => {
    const s = await customerLogin('55555555555');
    const other = (await ccall(s, 'GET', '/api/customer/vends')).json().items[0].id;
    const mine = await ccall(s, 'GET', `/api/customer/vends/${other}`);
    expect(mine.statusCode).toBe(200);
    const s2 = await customerLogin('55555559999');
    expect((await ccall(s2, 'GET', `/api/customer/vends/${other}`)).statusCode).toBe(404);
    const noCsrf = await app.inject({ method: 'POST', url: '/api/customer/quotes', payload: { mode: 'units', value: '1' }, headers: { cookie: s.cookie } });
    expect(noCsrf.statusCode).toBe(403);
    // Staff sessions cannot use customer routes.
    expect((await call(cashier, 'POST', '/api/customer/quotes', { mode: 'units', value: '1' })).statusCode).toBe(401);
  });

  it('signs a customer out when staff reset the PIN', async () => {
    const id = (await call(supervisor, 'GET', '/api/customers?q=55555555555')).json().items[0].id;
    const s = await customerLogin('55555555555');
    expect((await call(supervisor, 'PATCH', `/api/customers/${id}`, { pin: '987654' })).statusCode).toBe(200);
    expect((await ccall(s, 'GET', '/api/customer/me')).statusCode).toBe(401);
    await customerLogin('55555555555', '987654');
  });
});
