import { decimalStringSchema, meterNoSchema } from '@tronic/core';
import Decimal from 'decimal.js';
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
// Cashiers take the cash at the counter, so they can top up as well.
const TOPUP_ROLES = ['cashier', 'supervisor', 'admin'] as const;
const VIEW_ROLES = ['cashier', 'supervisor', 'admin', 'auditor'] as const;

/** Staff side of customer accounts: register, top up, reset PIN, deactivate. */
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
      if (isUniqueViolation(e)) throw new HttpError(409, 'METER_TAKEN', 'A customer is already registered for this meter');
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
      if (!found) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
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

  app.post('/api/customers/:id/topups', { preHandler: requireRole(...TOPUP_ROLES) }, async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ amount: decimalStringSchema, note: z.string().trim().max(200).optional() }).parse(req.body);
    const idempotencyKey = z.string().min(8).max(100).parse(req.headers['idempotency-key'], { path: ['Idempotency-Key'] });
    const amount = new Decimal(body.amount);
    if (amount.lte(0)) throw new HttpError(400, 'INVALID_VALUE', 'Enter an amount above zero');
    if (amount.gt(ctx.cfg.MAX_VEND_AMOUNT)) throw new HttpError(400, 'LIMIT', `Maximum top-up is ${ctx.cfg.MAX_VEND_AMOUNT} ${ctx.cfg.CURRENCY}`);

    try {
      await ctx.db.tx(async (q) => {
        const replay = (await q.query('SELECT customer_id FROM customer_ledger WHERE idempotency_key = $1', [idempotencyKey])).rows[0];
        if (replay) {
          if (replay.customer_id !== id) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used');
          return;
        }
        const c = (await q.query<{ active: boolean }>('SELECT active FROM customers WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!c) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
        if (!c.active) throw new HttpError(409, 'CUSTOMER_INACTIVE', 'Reactivate this customer before topping up');
        const after = (
          await q.query<{ balance: string }>('UPDATE customers SET balance = balance + $2 WHERE id = $1 RETURNING balance::text AS balance', [id, amount.toString()])
        ).rows[0]!.balance;
        await q.query(
          `INSERT INTO customer_ledger (customer_id, kind, amount, balance_after, user_id, idempotency_key, note) VALUES ($1, 'topup', $2, $3, $4, $5, $6)`,
          [id, amount.toString(), after, user.id, idempotencyKey, body.note || null],
        );
        await writeAudit(q, { actorId: user.id, action: 'customer.topped_up', entity: 'customer', entityId: id, detail: { amount: amount.toString(), balanceAfter: after } });
      });
    } catch (e) {
      // Two identical requests raced; the first one won and this is its replay.
      if (!isUniqueViolation(e, 'idempotency_key')) throw e;
    }
    return customerView((await ctx.db.query<CustomerRow>(`${CUSTOMER_SELECT} WHERE id = $1`, [id])).rows[0]!);
  });

  app.get('/api/customers/:id/ledger', { preHandler: requireRole(...VIEW_ROLES) }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const rows = (
      await ctx.db.query(
        `SELECT l.id::text AS id, l.kind, l.amount::text AS amount, l.balance_after::text AS balance_after, l.note, l.created_at,
                l.vend_id, u.display_name AS by_name, c.currency
           FROM customer_ledger l JOIN customers c ON c.id = l.customer_id LEFT JOIN users u ON u.id = l.user_id
          WHERE l.customer_id = $1 ORDER BY l.id DESC LIMIT 100`,
        [id],
      )
    ).rows;
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        amount: formatAmount(r.amount, r.currency),
        balanceAfter: formatAmount(r.balance_after, r.currency),
        note: r.note,
        vendId: r.vend_id,
        by: r.by_name,
        createdAt: r.created_at,
      })),
    };
  });
}
