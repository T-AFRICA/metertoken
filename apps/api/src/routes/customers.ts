import { meterNoSchema } from '@tronic/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit';
import type { AppContext } from '../context';
import { isUniqueViolation, type Queryable } from '../db';
import { HttpError, requireRole, requireUser, type SessionUser } from '../http';
import { CUSTOMER_SELECT, customerView, isLandlord, pinSchema, type CustomerRow } from '../services/customers';
import { createQuoteService } from '../services/quotes';
import { formatAmount } from '../services/vends';
import { hashPassword } from './auth';

const uuid = z.string().uuid();
// Landlords manage their own tenants; supervisors and admins manage all of them.
const MANAGE_ROLES = ['supervisor', 'admin', 'landlord'] as const;
const VIEW_ROLES = ['cashier', 'supervisor', 'admin', 'auditor', 'landlord'] as const;

/** Loads a tenant the user may see: a landlord gets a 404 for anyone else's tenant. */
async function visibleTenant(q: Queryable, user: SessionUser, id: string) {
  const row = (await q.query<{ landlord_id: string | null }>('SELECT landlord_id FROM customers WHERE id = $1', [id])).rows[0];
  if (!row || (isLandlord(user) && row.landlord_id !== user.id)) throw new HttpError(404, 'NOT_FOUND', 'Tenant not found');
  return row;
}

/** Checks that an admin-chosen landlord exists and is an active landlord account. */
async function assertLandlordAccount(q: Queryable, landlordId: string) {
  const row = (await q.query("SELECT 1 FROM users WHERE id = $1 AND role = 'landlord' AND active", [landlordId])).rows[0];
  if (!row) throw new HttpError(400, 'INVALID_LANDLORD', 'Choose an active landlord account');
}

/** Staff and landlord side of tenant accounts: register, reset PIN, deactivate, see their tokens. */
export function customerAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const quotes = createQuoteService(ctx);

  app.get('/api/customers', { preHandler: requireRole(...VIEW_ROLES) }, async (req) => {
    const user = requireUser(req);
    const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
    const rows = (
      await ctx.db.query<CustomerRow>(
        `${CUSTOMER_SELECT}
          WHERE ($1::text IS NULL OR c.meter_no LIKE $1 || '%' OR c.name ILIKE '%' || $1 || '%' OR c.phone LIKE '%' || $1 || '%')
            AND ($2::uuid IS NULL OR c.landlord_id = $2)
          ORDER BY c.created_at DESC LIMIT 200`,
        [q || null, isLandlord(user) ? user.id : null],
      )
    ).rows;
    return { items: rows.map(customerView) };
  });

  // Landlord accounts, for the admin's "which landlord" picker.
  app.get('/api/landlords', { preHandler: requireRole('supervisor', 'admin', 'auditor') }, async () => {
    const rows = (
      await ctx.db.query(
        `SELECT u.id, u.username, u.display_name, u.active, count(c.id)::int AS tenants
           FROM users u LEFT JOIN customers c ON c.landlord_id = u.id
          WHERE u.role = 'landlord' GROUP BY u.id ORDER BY u.display_name`,
      )
    ).rows;
    return { items: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, active: r.active, tenants: r.tenants })) };
  });

  app.post('/api/customers', { preHandler: requireRole(...MANAGE_ROLES) }, async (req) => {
    const user = requireUser(req);
    const body = z
      .object({
        meterNo: meterNoSchema,
        name: z.string().trim().min(1).max(100),
        phone: z.string().trim().max(20).regex(/^[0-9+ ]*$/, 'Digits, + and spaces only').optional(),
        pin: pinSchema,
        landlordId: uuid.optional(),
      })
      .parse(req.body);
    // A landlord's tenants are always their own; staff may assign one to any landlord.
    const landlordId = isLandlord(user) ? user.id : (body.landlordId ?? null);
    // Only real meters can be registered.
    await quotes.verifyMeter(body.meterNo);
    try {
      return await ctx.db.tx(async (q) => {
        if (landlordId && !isLandlord(user)) await assertLandlordAccount(q, landlordId);
        const id = (
          await q.query<{ id: string }>(
            'INSERT INTO customers (meter_no, name, phone, pin_hash, currency, created_by, landlord_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [body.meterNo, body.name, body.phone || null, await hashPassword(body.pin), ctx.cfg.CURRENCY, user.id, landlordId],
          )
        ).rows[0]!.id;
        await writeAudit(q, {
          actorId: user.id,
          action: 'customer.registered',
          entity: 'customer',
          entityId: id,
          detail: { meterNo: body.meterNo, name: body.name, landlordId },
        });
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
        /** Staff only: move the tenant to another landlord, or null for none. */
        landlordId: uuid.nullable().optional(),
      })
      .parse(req.body);
    if (body.landlordId !== undefined && isLandlord(user)) throw new HttpError(403, 'FORBIDDEN', 'Only Tronic staff can move a tenant to another landlord');
    await ctx.db.tx(async (q) => {
      await visibleTenant(q, user, id);
      if (body.landlordId) await assertLandlordAccount(q, body.landlordId);
      if (body.name) await q.query('UPDATE customers SET name = $2 WHERE id = $1', [id, body.name]);
      if (body.phone !== undefined) await q.query('UPDATE customers SET phone = $2 WHERE id = $1', [id, body.phone || null]);
      if (body.active !== undefined) await q.query('UPDATE customers SET active = $2 WHERE id = $1', [id, body.active]);
      if (body.pin) await q.query('UPDATE customers SET pin_hash = $2 WHERE id = $1', [id, await hashPassword(body.pin)]);
      if (body.landlordId !== undefined) await q.query('UPDATE customers SET landlord_id = $2 WHERE id = $1', [id, body.landlordId]);
      // A new PIN or a deactivation signs the customer out everywhere.
      if (body.pin || body.active === false) await q.query('DELETE FROM customer_sessions WHERE customer_id = $1', [id]);
      await writeAudit(q, {
        actorId: user.id,
        action: 'customer.updated',
        entity: 'customer',
        entityId: id,
        detail: { name: body.name, phoneChanged: body.phone !== undefined, active: body.active, accessReset: Boolean(body.pin), landlordId: body.landlordId },
      });
    });
    return { ok: true };
  });

  // The customer's tokens and this month's totals, for settling with the tenant.
  app.get('/api/customers/:id/vends', { preHandler: requireRole(...VIEW_ROLES) }, async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await visibleTenant(ctx.db, user, id);
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
