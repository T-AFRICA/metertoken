import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import type { AppContext } from '../context';
import { HttpError, isSupervisor, requireRole, requireUser } from '../http';
import { canSeeToken, checkVendStatus, createVend, formatAmount, loadVend, resolveVend, vendView } from '../services/vends';

const VEND_ROLES = ['cashier', 'supervisor', 'admin'] as const;
const uuid = z.string().uuid();

export function vendRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/vends', { preHandler: requireRole(...VEND_ROLES) }, async (req) => {
    const user = requireUser(req);
    const body = z.object({ quoteId: uuid, confirmDuplicate: z.boolean().default(false) }).parse(req.body);
    const idempotencyKey = z.string().min(8).max(100).parse(req.headers['idempotency-key'], { path: ['Idempotency-Key'] });
    const vend = await createVend(ctx, user, { ...body, idempotencyKey });
    // The operator who just generated the token always sees it once here.
    return vendView(ctx, vend, { withTokens: vend.user_id === user.id || isSupervisor(user) });
  });

  app.get('/api/vends/:id', async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const v = await loadVend(ctx.db, id);
    if (!v) throw new HttpError(404, 'NOT_FOUND', 'Vend not found');
    if (user.role === 'cashier' && v.user_id !== user.id) throw new HttpError(403, 'FORBIDDEN', 'Not your transaction');
    const withTokens = canSeeToken(user, v) && Boolean(v.token_enc);
    if (withTokens) await audit(ctx.db, { actorId: user.id, action: 'vend.token_viewed', entity: 'vend', entityId: id });
    return vendView(ctx, v, { withTokens });
  });

  app.get('/api/vends', async (req) => {
    const user = requireUser(req);
    const f = z
      .object({
        status: z.enum(['PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'MANUAL_REVIEW']).optional(),
        meterNo: z.string().trim().max(13).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);

    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (user.role === 'cashier') add('v.user_id = ?', user.id);
    if (f.status) add('v.status = ?', f.status);
    if (f.meterNo) add('v.meter_no = ?', f.meterNo);
    if (f.from) add('v.created_at >= ?::date', f.from);
    if (f.to) add(`v.created_at < ?::date + 1`, f.to);
    params.push(f.limit, f.offset);

    const rows = (
      await ctx.db.query(
        `SELECT v.id, v.client_ref AS reference, v.meter_no, u.display_name AS operator, v.mode, v.units::text AS units,
                v.amount::text AS amount, v.currency, v.status, v.adapter_mode, v.token_last4, v.created_at
           FROM vends v JOIN users u ON u.id = v.user_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY v.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows;
    return {
      items: rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        meterNo: r.meter_no,
        operator: r.operator,
        mode: r.mode,
        units: r.units,
        amount: formatAmount(r.amount, r.currency),
        currency: r.currency,
        status: r.status,
        adapterMode: r.adapter_mode,
        tokenLast4: r.token_last4,
        createdAt: r.created_at,
      })),
    };
  });

  app.post('/api/vends/:id/print', async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { reprint } = z.object({ reprint: z.boolean() }).parse(req.body);
    const v = await loadVend(ctx.db, id);
    if (!v || v.status !== 'SUCCEEDED') throw new HttpError(409, 'NOT_PRINTABLE', 'Only successful vends can be printed');
    if (!canSeeToken(user, v)) throw new HttpError(403, 'FORBIDDEN', 'Ask a supervisor to reprint this receipt');
    await ctx.db.query('INSERT INTO receipt_prints (vend_id, user_id, reprint) VALUES ($1, $2, $3)', [id, user.id, reprint]);
    await audit(ctx.db, { actorId: user.id, action: reprint ? 'receipt.reprinted' : 'receipt.printed', entity: 'vend', entityId: id });
    return { ok: true };
  });

  app.post('/api/vends/:id/check-status', { preHandler: requireRole('supervisor', 'admin') }, async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const result = await checkVendStatus(ctx, user.id, id);
    return { result };
  });

  app.post('/api/vends/:id/resolve', { preHandler: requireRole('supervisor', 'admin') }, async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({ outcome: z.enum(['SUCCEEDED', 'FAILED']), note: z.string().trim().min(5).max(500), token: z.string().trim().optional() })
      .parse(req.body);
    await resolveVend(ctx, user, id, body);
    return vendView(ctx, (await loadVend(ctx.db, id))!, { withTokens: true });
  });
}
