import { hash, verify } from '@node-rs/argon2';
import { decimalStringSchema, meterNoSchema } from '@tronic/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import { cookieSecure } from '../config';
import type { AppContext } from '../context';
import { HttpError } from '../http';
import { randomToken, sha256 } from '../security';
import { CUSTOMER_SELECT, customerView, pinSchema, selfServiceUser, type CustomerRow } from '../services/customers';
import { createQuoteService } from '../services/quotes';
import { createVend, formatAmount, loadVend, vendView } from '../services/vends';

export const CUSTOMER_COOKIE = 'tsp_customer';
const CUSTOMER_SESSION_HOURS = 2;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const uuid = z.string().uuid();

interface CustomerSession {
  id: string;
  sessionId: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    customer: CustomerSession | null;
  }
}

function requireCustomer(req: FastifyRequest): CustomerSession {
  if (!req.customer) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in with your meter number and PIN');
  return req.customer;
}

/**
 * The customer page: a registered customer signs in with their meter number and PIN and generates
 * tokens for that meter only. Payment is settled with the tenant outside the portal.
 */
export function customerRoutes(app: FastifyInstance, ctx: AppContext) {
  const quotes = createQuoteService(ctx);
  const failures = new Map<string, { count: number; first: number }>();
  // Checking a dummy hash keeps the response time the same for meters that are not registered.
  const dummyHash = hash(randomToken());

  app.decorateRequest('customer', null);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/customer/')) return;
    const raw = req.cookies[CUSTOMER_COOKIE];
    if (raw) {
      const row = (
        await ctx.db.query<{ id: string; customer_id: string; csrf_token: string }>(
          `SELECT s.id, s.customer_id, s.csrf_token FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
            WHERE s.id = $1 AND s.expires_at > now() AND c.active`,
          [sha256(raw)],
        )
      ).rows[0];
      if (row) req.customer = { id: row.customer_id, sessionId: row.id, csrfToken: row.csrf_token };
    }
    const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (stateChanging && req.customer && req.url !== '/api/customer/login' && req.headers['x-csrf-token'] !== req.customer.csrfToken) {
      throw new HttpError(403, 'CSRF', 'Security token missing or expired; reload the page');
    }
  });

  const loadCustomer = async (id: string) => (await ctx.db.query<CustomerRow>(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id])).rows[0]!;

  app.post('/api/customer/login', async (req, reply) => {
    const body = z.object({ meterNo: meterNoSchema, pin: pinSchema }).parse(req.body);
    const f = failures.get(body.meterNo);
    if (f && f.count >= MAX_FAILURES && Date.now() - f.first < LOCKOUT_MS) {
      throw new HttpError(429, 'LOCKED', 'Too many wrong PINs. Try again in 15 minutes, or ask your landlord to reset your PIN.');
    }
    const row = (await ctx.db.query<{ id: string; pin_hash: string }>('SELECT id, pin_hash FROM customers WHERE meter_no = $1 AND active', [body.meterNo])).rows[0];
    const ok = await verify(row?.pin_hash ?? (await dummyHash), body.pin).catch(() => false);
    if (!row || !ok) {
      const cur = f && Date.now() - f.first < LOCKOUT_MS ? f : { count: 0, first: Date.now() };
      failures.set(body.meterNo, { ...cur, count: cur.count + 1 });
      await audit(ctx.db, { actorId: null, action: 'customer.login_failed', entity: 'meter', entityId: body.meterNo, detail: { ip: req.ip } });
      throw new HttpError(401, 'INVALID_LOGIN', 'Meter number or PIN is not right');
    }
    failures.delete(body.meterNo);

    const raw = randomToken();
    const csrfToken = randomToken();
    const expires = new Date(Date.now() + CUSTOMER_SESSION_HOURS * 3600 * 1000);
    await ctx.db.query('INSERT INTO customer_sessions (id, customer_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4)', [sha256(raw), row.id, csrfToken, expires]);
    await ctx.db.query('UPDATE customers SET last_login_at = now() WHERE id = $1', [row.id]);
    await audit(ctx.db, { actorId: null, action: 'customer.login', entity: 'customer', entityId: row.id, detail: { ip: req.ip } });

    reply.setCookie(CUSTOMER_COOKIE, raw, { httpOnly: true, sameSite: 'lax', secure: cookieSecure(ctx.cfg), path: '/api/customer/', expires });
    return { customer: customerView(await loadCustomer(row.id)), csrfToken, adapterMode: ctx.adapter.mode };
  });

  app.post('/api/customer/logout', async (req, reply) => {
    const c = requireCustomer(req);
    await ctx.db.query('DELETE FROM customer_sessions WHERE id = $1', [c.sessionId]);
    reply.clearCookie(CUSTOMER_COOKIE, { path: '/api/customer/' });
    return { ok: true };
  });

  app.get('/api/customer/me', async (req) => {
    const c = requireCustomer(req);
    return { customer: customerView(await loadCustomer(c.id)), csrfToken: c.csrfToken, adapterMode: ctx.adapter.mode };
  });

  app.post('/api/customer/quotes', async (req) => {
    const c = requireCustomer(req);
    const body = z.object({ mode: z.enum(['units', 'amount']), value: decimalStringSchema }).parse(req.body);
    const customer = await loadCustomer(c.id);
    const service = await selfServiceUser(ctx.db);
    const q = await quotes.createQuote(service.id, customer.meter_no, body.mode, body.value);
    return q;
  });

  app.post('/api/customer/vends', async (req) => {
    const c = requireCustomer(req);
    const { quoteId } = z.object({ quoteId: uuid }).parse(req.body);
    const idempotencyKey = z.string().min(8).max(100).parse(req.headers['idempotency-key'], { path: ['Idempotency-Key'] });
    const service = await selfServiceUser(ctx.db);
    const vend = await createVend(ctx, service, { quoteId, idempotencyKey, confirmDuplicate: false, customerId: c.id });
    return { vend: vendView(ctx, vend, { withTokens: true }), customer: customerView(await loadCustomer(c.id)) };
  });

  app.get('/api/customer/vends', async (req) => {
    const c = requireCustomer(req);
    const rows = (
      await ctx.db.query(
        `SELECT id, units::text AS units, amount::text AS amount, currency, status, token_last4, created_at
           FROM vends WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [c.id],
      )
    ).rows;
    return {
      items: rows.map((r) => ({
        id: r.id,
        units: r.units,
        amount: formatAmount(r.amount, r.currency),
        currency: r.currency,
        status: r.status,
        tokenLast4: r.token_last4,
        createdAt: r.created_at,
      })),
    };
  });

  app.get('/api/customer/vends/:id', async (req) => {
    const c = requireCustomer(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const v = await loadVend(ctx.db, id);
    if (!v || v.customer_id !== c.id) throw new HttpError(404, 'NOT_FOUND', 'Token not found');
    if (v.token_enc) await audit(ctx.db, { actorId: null, action: 'customer.token_viewed', entity: 'vend', entityId: id, detail: { customerId: c.id } });
    return vendView(ctx, v, { withTokens: true });
  });
}
