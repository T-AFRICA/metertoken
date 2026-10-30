import { currencySchema, decimalStringSchema, roleSchema } from '@tronic/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, verifyAuditChain, writeAudit } from '../audit';
import type { AppContext } from '../context';
import { isUniqueViolation } from '../db';
import { HttpError, requireRole, requireUser } from '../http';
import { SELF_SERVICE_USERNAME } from '../services/customers';
import { hashPassword } from './auth';

const uuid = z.string().uuid();
const password = z.string().min(10, 'Password must be at least 10 characters').max(200);
const REPORT_ROLES = ['supervisor', 'admin', 'auditor'] as const;

function csvCell(v: unknown): string {
  const s = v instanceof Date ? v.toISOString() : String(v ?? '');
  // Prefix formula-like values so spreadsheets do not execute them.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const dateRange = z.object({ from: z.string().date(), to: z.string().date() });

export function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  // ---- Users -------------------------------------------------------------
  app.get('/api/admin/users', { preHandler: requireRole('admin') }, async () => {
    const rows = (
      await ctx.db.query('SELECT id, username, display_name, role, active, created_at, last_login_at FROM users WHERE username <> $1 ORDER BY username', [SELF_SERVICE_USERNAME])
    ).rows;
    return {
      items: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        role: r.role,
        active: r.active,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
      })),
    };
  });

  app.post('/api/admin/users', { preHandler: requireRole('admin') }, async (req) => {
    const admin = requireUser(req);
    const body = z
      .object({
        username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, dash and underscore only'),
        displayName: z.string().trim().min(1).max(100),
        role: roleSchema,
        password,
      })
      .parse(req.body);
    try {
      const id = (
        await ctx.db.query<{ id: string }>(
          'INSERT INTO users (username, display_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
          [body.username, body.displayName, body.role, await hashPassword(body.password)],
        )
      ).rows[0]!.id;
      await audit(ctx.db, { actorId: admin.id, action: 'user.created', entity: 'user', entityId: id, detail: { username: body.username, role: body.role } });
      return { id };
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, 'USERNAME_TAKEN', 'That username is already in use');
      throw e;
    }
  });

  app.patch('/api/admin/users/:id', { preHandler: requireRole('admin') }, async (req) => {
    const admin = requireUser(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({ displayName: z.string().trim().min(1).max(100).optional(), role: roleSchema.optional(), active: z.boolean().optional(), password: password.optional() })
      .parse(req.body);
    if (id === admin.id && (body.active === false || (body.role && body.role !== 'admin'))) {
      throw new HttpError(400, 'SELF_LOCKOUT', 'You cannot deactivate yourself or remove your own admin role');
    }
    await ctx.db.tx(async (q) => {
      const found = (await q.query('SELECT 1 FROM users WHERE id = $1 AND username <> $2', [id, SELF_SERVICE_USERNAME])).rows[0];
      if (!found) throw new HttpError(404, 'NOT_FOUND', 'User not found');
      if (body.displayName) await q.query('UPDATE users SET display_name = $2 WHERE id = $1', [id, body.displayName]);
      if (body.role) await q.query('UPDATE users SET role = $2 WHERE id = $1', [id, body.role]);
      if (body.active !== undefined) await q.query('UPDATE users SET active = $2 WHERE id = $1', [id, body.active]);
      if (body.password) await q.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await hashPassword(body.password)]);
      // Any change to role, status or password ends the user's sessions.
      if (body.role || body.active !== undefined || body.password) await q.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      await writeAudit(q, {
        actorId: admin.id,
        action: 'user.updated',
        entity: 'user',
        entityId: id,
        detail: { displayName: body.displayName, role: body.role, active: body.active, passwordChanged: Boolean(body.password) },
      });
    });
    return { ok: true };
  });

  // ---- Tariffs (maker-checker) -------------------------------------------
  app.get('/api/admin/tariffs', { preHandler: requireRole('admin', 'supervisor', 'auditor') }, async () => {
    const tariffs = (await ctx.db.query('SELECT id, code, name, currency FROM tariffs ORDER BY code')).rows;
    const versions = (
      await ctx.db.query(
        `SELECT v.id, v.tariff_id, v.base_rate::text AS base_rate, v.percent_charges, v.fixed_charges, v.status, v.note,
                v.created_at, v.approved_at, c.display_name AS created_by, a.display_name AS approved_by
           FROM tariff_versions v
           LEFT JOIN users c ON c.id = v.created_by
           LEFT JOIN users a ON a.id = v.approved_by
          ORDER BY v.created_at DESC`,
      )
    ).rows;
    return {
      items: tariffs.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        currency: t.currency,
        versions: versions
          .filter((v) => v.tariff_id === t.id)
          .map((v) => ({
            id: v.id,
            baseRate: v.base_rate,
            percentCharges: v.percent_charges,
            fixedCharges: v.fixed_charges,
            status: v.status,
            note: v.note,
            createdBy: v.created_by,
            createdAt: v.created_at,
            approvedBy: v.approved_by,
            approvedAt: v.approved_at,
          })),
      })),
    };
  });

  app.post('/api/admin/tariffs', { preHandler: requireRole('admin') }, async (req) => {
    const admin = requireUser(req);
    const body = z
      .object({ code: z.string().trim().min(1).max(32).regex(/^[A-Z0-9_-]+$/, 'Use capitals, digits, - and _'), name: z.string().trim().min(1).max(100), currency: currencySchema })
      .parse(req.body);
    try {
      const id = (await ctx.db.query<{ id: string }>('INSERT INTO tariffs (code, name, currency) VALUES ($1, $2, $3) RETURNING id', [body.code, body.name, body.currency])).rows[0]!.id;
      await audit(ctx.db, { actorId: admin.id, action: 'tariff.created', entity: 'tariff', entityId: id, detail: body });
      return { id };
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, 'CODE_TAKEN', 'A tariff with that code already exists');
      throw e;
    }
  });

  app.post('/api/admin/tariffs/:code/versions', { preHandler: requireRole('admin') }, async (req) => {
    const admin = requireUser(req);
    const { code } = z.object({ code: z.string() }).parse(req.params);
    const body = z
      .object({
        baseRate: decimalStringSchema,
        percentCharges: z.array(z.object({ name: z.string().trim().min(1).max(50), percent: decimalStringSchema })).max(10),
        fixedCharges: z.array(z.object({ name: z.string().trim().min(1).max(50), amount: decimalStringSchema })).max(10),
        note: z.string().trim().max(500).optional(),
      })
      .parse(req.body);
    const tariff = (await ctx.db.query<{ id: string }>('SELECT id FROM tariffs WHERE code = $1', [code])).rows[0];
    if (!tariff) throw new HttpError(404, 'NOT_FOUND', 'Tariff not found');
    const id = (
      await ctx.db.query<{ id: string }>(
        `INSERT INTO tariff_versions (tariff_id, base_rate, percent_charges, fixed_charges, status, note, created_by)
         VALUES ($1, $2, $3, $4, 'draft', $5, $6) RETURNING id`,
        [tariff.id, body.baseRate, JSON.stringify(body.percentCharges), JSON.stringify(body.fixedCharges), body.note ?? null, admin.id],
      )
    ).rows[0]!.id;
    await audit(ctx.db, { actorId: admin.id, action: 'tariff.version_drafted', entity: 'tariff_version', entityId: id, detail: { code, ...body } });
    return { id };
  });

  app.post('/api/admin/tariff-versions/:id/approve', { preHandler: requireRole('admin') }, async (req) => {
    const admin = requireUser(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await ctx.db.tx(async (q) => {
      const v = (await q.query('SELECT id, tariff_id, status, created_by FROM tariff_versions WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!v) throw new HttpError(404, 'NOT_FOUND', 'Tariff version not found');
      if (v.status !== 'draft') throw new HttpError(409, 'NOT_DRAFT', 'Only draft versions can be approved');
      if (v.created_by === admin.id) throw new HttpError(403, 'MAKER_CHECKER', 'A different admin must approve this tariff');
      await q.query(`UPDATE tariff_versions SET status = 'retired' WHERE tariff_id = $1 AND status = 'active'`, [v.tariff_id]);
      await q.query(`UPDATE tariff_versions SET status = 'active', approved_by = $2, approved_at = now() WHERE id = $1`, [id, admin.id]);
      await writeAudit(q, { actorId: admin.id, action: 'tariff.version_approved', entity: 'tariff_version', entityId: id });
    });
    return { ok: true };
  });

  // ---- Audit log ---------------------------------------------------------
  app.get('/api/admin/audit', { preHandler: requireRole('admin', 'auditor') }, async (req) => {
    const f = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), action: z.string().max(64).optional() }).parse(req.query);
    const rows = (
      await ctx.db.query(
        `SELECT e.id::text AS id, e.at, u.display_name AS actor, e.action, e.entity, e.entity_id, e.detail
           FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id
          WHERE ($1::text IS NULL OR e.action LIKE $1 || '%')
          ORDER BY e.id DESC LIMIT $2`,
        [f.action ?? null, f.limit],
      )
    ).rows;
    return { items: rows.map((r) => ({ id: r.id, at: r.at, actor: r.actor ?? 'system', action: r.action, entity: r.entity, entityId: r.entity_id, detail: r.detail })) };
  });

  app.get('/api/admin/audit/verify', { preHandler: requireRole('admin', 'auditor') }, async () => verifyAuditChain(ctx.db));

  // ---- Reports & export --------------------------------------------------
  app.get('/api/admin/reports/summary', { preHandler: requireRole(...REPORT_ROLES) }, async (req) => {
    const { from, to } = dateRange.parse(req.query);
    const rows = (
      await ctx.db.query(
        `SELECT to_char(v.created_at, 'YYYY-MM-DD') AS day, u.display_name AS operator, v.status, v.currency,
                count(*)::int AS count, sum(v.units)::text AS units, sum(v.amount)::text AS amount
           FROM vends v JOIN users u ON u.id = v.user_id
          WHERE v.created_at >= $1::date AND v.created_at < $2::date + 1
          GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, 2, 3`,
        [from, to],
      )
    ).rows;
    return { from, to, rows };
  });

  app.get('/api/admin/reports/export.csv', { preHandler: requireRole(...REPORT_ROLES) }, async (req, reply) => {
    const user = requireUser(req);
    const { from, to } = dateRange.parse(req.query);
    const rows = (
      await ctx.db.query(
        `SELECT v.created_at, v.client_ref, v.meter_no, u.username, v.mode, v.units::text AS units, v.amount::text AS amount,
                v.currency, v.status, v.adapter_mode, v.vendor_ref, v.token_last4
           FROM vends v JOIN users u ON u.id = v.user_id
          WHERE v.created_at >= $1::date AND v.created_at < $2::date + 1 ORDER BY v.created_at`,
        [from, to],
      )
    ).rows;
    await audit(ctx.db, { actorId: user.id, action: 'report.exported', detail: { from, to, rows: rows.length } });
    const header = ['created_at', 'reference', 'meter_no', 'operator', 'mode', 'units', 'amount', 'currency', 'status', 'adapter', 'vendor_ref', 'token_last4'];
    const body = rows.map((r) =>
      [r.created_at, r.client_ref, r.meter_no, r.username, r.mode, r.units, r.amount, r.currency, r.status, r.adapter_mode, r.vendor_ref, r.token_last4].map(csvCell).join(','),
    );
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="vends_${from}_${to}.csv"`);
    // Full tokens are never exported.
    return [header.join(','), ...body].join('\n');
  });

  // ---- Live STS mode approvals --------------------------------------------
  app.get('/api/admin/live-mode', { preHandler: requireRole('admin') }, async () => {
    const approvals = (
      await ctx.db.query('SELECT u.display_name AS admin, a.approved_at FROM live_mode_approvals a JOIN users u ON u.id = a.admin_id ORDER BY a.approved_at')
    ).rows;
    return { currentMode: ctx.adapter.mode, requestedMode: ctx.cfg.STS_MODE, envEnabled: ctx.cfg.STS_LIVE_ENABLED, approvals };
  });

  app.post('/api/admin/live-mode/approve', { preHandler: requireRole('admin') }, async (req) => {
    const admin = requireUser(req);
    await ctx.db.tx(async (q) => {
      await q.query('INSERT INTO live_mode_approvals (admin_id) VALUES ($1) ON CONFLICT DO NOTHING', [admin.id]);
      await writeAudit(q, { actorId: admin.id, action: 'live_mode.approved' });
    });
    return { ok: true };
  });

  app.post('/api/admin/live-mode/revoke', { preHandler: requireRole('admin') }, async (req) => {
    const admin = requireUser(req);
    await ctx.db.tx(async (q) => {
      await q.query('DELETE FROM live_mode_approvals');
      await writeAudit(q, { actorId: admin.id, action: 'live_mode.revoked' });
    });
    return { ok: true, note: 'All approvals removed. Live vending is blocked immediately; set STS_MODE=mock and restart to return to mock mode.' };
  });
}
