import { decimalStringSchema, meterNoSchema } from '@tronic/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit';
import type { AppContext } from '../context';
import { isUniqueViolation } from '../db';
import { HttpError, requireRole, requireUser } from '../http';
import { CUSTOMER_SELECT, customerView, pinSchema, type CustomerRow } from '../services/customers';
import { createQuoteService } from '../services/quotes';
import { formatAmount } from '../services/vends';
import { hashPassword } from './auth';

const uuid = z.string().uuid();
const MANAGE_ROLES = ['supervisor', 'admin'] as const;
const VIEW_ROLES = ['cashier', 'supervisor', 'admin', 'auditor'] as const;

/** Staff side of customer accounts: register, reset PIN, deactivate, see their tokens. */
export function customerAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const quotes = createQuoteService(ctx);

  app.get('/api/customers', { preHandler: requireRole(...VIEW_ROLES) }, async (req) => {
    const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
    const rows = (
      await ctx.db.query<CustomerRow>(
        `${CUSTOMER_SELECT} WHERE ($1::text IS NULL OR meter_no LIKE $1 || '%' OR name ILIKE '%' || $1 || '%' OR phone LIKE '%' || $1 || '%')
          ORDER BY created_at DESC LIMIT 200`,
        [q || null],
      )
    ).rows;
    return { items: rows.map(customerView) };
  });

  app.post('/api/customers', { preHandler: requireRole(...MANAGE_ROLES) }, async (req) => {
    const user = requireUser(req);
    const body = z
      .object({
        meterNo: meterNoSchema,
        name: z.string().trim().min(1).max(100),
        phone: z.string().trim().max(20).regex(/^[0-9+ ]*$/, 'Digits, + and spaces only').optional(),
        pin: pinSchema,
      })
      .parse(req.body);
    // Only real meters can be registered.
    await quotes.verifyMeter(body.meterNo);
    try {
      return await ctx.db.tx(async (q) => {
        const id = (
          await q.query<{ id: string }>(
            'INSERT INTO customers (meter_no, name, phone, pin_hash, currency, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [body.meterNo, body.name, body.phone || null, await hashPassword(body.pin), ctx.cfg.CURRENCY, user.id],
          )
        ).rows[0]!.id;
        await writeAudit(q, { actorId: user.id, action: 'customer.registered', entity: 'customer', entityId: id, detail: { meterNo: body.meterNo, name: body.name } });
        return { id };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, 'METER_TAKEN', 'A tenant is already registered for this meter');
      throw e;
    }
  });

  app.patch('/api/customers/:id', { preHandler: requireRole(...MANAGE_ROLES) }, async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        phone: z.string().trim().max(20).regex(/^[0-9+ ]*$/, 'Digits, + and spaces only').optional(),
        active: z.boolean().optional(),
        pin: pinSchema.optional(),
      })
      .parse(req.body);
    await ctx.db.tx(async (q) => {
      const found = (await q.query('SELECT 1 FROM customers WHERE id = $1', [id])).rows[0];
      if (!found) throw new HttpError(404, 'NOT_FOUND', 'Tenant not found');
      if (body.name) await q.query('UPDATE customers SET name = $2 WHERE id = $1', [id, body.name]);
      if (body.phone !== undefined) await q.query('UPDATE customers SET phone = $2 WHERE id = $1', [id, body.phone || null]);
      if (body.active !== undefined) await q.query('UPDATE customers SET active = $2 WHERE id = $1', [id, body.active]);
      if (body.pin) await q.query('UPDATE customers SET pin_hash = $2 WHERE id = $1', [id, await hashPassword(body.pin)]);
      // A new PIN or a deactivation signs the customer out everywhere.
      if (body.pin || body.active === false) await q.query('DELETE FROM customer_sessions WHERE customer_id = $1', [id]);
      await writeAudit(q, {
        actorId: user.id,
        action: 'customer.updated',
        entity: 'customer',
        entityId: id,
        detail: { name: body.name, phoneChanged: body.phone !== undefined, active: body.active, accessReset: Boolean(body.pin) },
      });
    });
    return { ok: true };
  });

  // The customer's tokens and this month's totals, for settling with the tenant.
  app.get('/api/customers/:id/vends', { preHandler: requireRole(...VIEW_ROLES) }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const rows = (
      await ctx.db.query(
        `SELECT id, units::text AS units, amount::text AS amount, currency, status, token_last4, created_at
           FROM vends WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [id],
      )
    ).rows;
    const month = (
      await ctx.db.query<{ count: number; units: string | null; amount: string | null }>(
        `SELECT count(*)::int AS count, sum(units)::text AS units, sum(amount)::text AS amount FROM vends
          WHERE customer_id = $1 AND status = 'SUCCEEDED' AND created_at >= date_trunc('month', now())`,
        [id],
      )
    ).rows[0]!;
    return {
      month: { count: month.count, units: month.units ?? '0', amount: formatAmount(month.amount ?? '0', ctx.cfg.CURRENCY), currency: ctx.cfg.CURRENCY },
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
}
