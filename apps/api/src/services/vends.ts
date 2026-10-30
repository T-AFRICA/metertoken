import {
  isMockToken,
  isStsTokenDigits,
  StsRejectedError,
  StsUnknownOutcomeError,
  tokenLast4,
  type IssueResult,
} from '@tronic/core';
import Decimal from 'decimal.js';
import { writeAudit } from '../audit';
import type { AppContext } from '../context';
import { isUniqueViolation, type Queryable } from '../db';
import { HttpError, isSupervisor, type SessionUser } from '../http';
import { decryptSecret, encryptSecret } from '../security';

export type VendStatus = 'PENDING' | 'SUBMITTED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'MANUAL_REVIEW';
const TOKEN_VISIBLE_TO_OWNER_MS = 24 * 3600 * 1000;

interface VendRow {
  id: string;
  client_ref: string;
  user_id: string;
  customer_id: string | null;
  operator: string;
  meter_no: string;
  mode: 'units' | 'amount';
  units: string;
  amount: string;
  currency: string;
  lines: { name: string; amount: string }[];
  status: VendStatus;
  adapter_mode: 'mock' | 'live';
  vendor_ref: string | null;
  token_enc: string | null;
  token_last4: string | null;
  error_message: string | null;
  resolution_note: string | null;
  created_at: Date;
  completed_at: Date | null;
}

const VEND_SELECT = `
  SELECT v.id, v.client_ref, v.user_id, v.customer_id, u.display_name AS operator, v.meter_no, v.mode,
         v.units::text AS units, v.amount::text AS amount, v.currency, v.lines, v.status, v.adapter_mode,
         v.vendor_ref, v.token_enc, v.token_last4, v.error_message, v.resolution_note, v.created_at, v.completed_at
    FROM vends v JOIN users u ON u.id = v.user_id`;

export async function loadVend(q: Queryable, id: string): Promise<VendRow | null> {
  return (await q.query<VendRow>(`${VEND_SELECT} WHERE v.id = $1`, [id])).rows[0] ?? null;
}

export function canSeeToken(user: SessionUser, v: Pick<VendRow, 'user_id' | 'created_at'>): boolean {
  if (isSupervisor(user)) return true;
  return (user.role === 'cashier' || user.role === 'landlord') && v.user_id === user.id && Date.now() - new Date(v.created_at).getTime() < TOKEN_VISIBLE_TO_OWNER_MS;
}

export const formatAmount = (amount: string, currency: string) =>
  new Decimal(amount).toFixed(currency === 'UGX' || currency === 'RWF' ? 0 : 2);

export function vendView(ctx: AppContext, v: VendRow, opts: { withTokens: boolean }) {
  return {
    id: v.id,
    reference: v.client_ref,
    meterNo: v.meter_no,
    operator: v.operator,
    mode: v.mode,
    units: v.units,
    amount: formatAmount(v.amount, v.currency),
    currency: v.currency,
    lines: v.lines,
    status: v.status,
    adapterMode: v.adapter_mode,
    vendorRef: v.vendor_ref,
    tokenLast4: v.token_last4,
    tokens: opts.withTokens && v.token_enc ? (JSON.parse(decryptSecret(v.token_enc, ctx.cfg.TOKEN_ENC_KEY)) as string[]) : null,
    errorMessage: v.error_message,
    resolutionNote: v.resolution_note,
    createdAt: v.created_at,
    completedAt: v.completed_at,
  };
}

async function recordAttempt(q: Queryable, vendId: string, operation: string, outcome: string, latencyMs: number, detail?: object) {
  await q.query('INSERT INTO vend_attempts (vend_id, operation, outcome, latency_ms, detail) VALUES ($1, $2, $3, $4, $5)', [
    vendId,
    operation,
    outcome,
    latencyMs,
    detail ? JSON.stringify(detail) : null,
  ]);
}

/** Checks the adapter result before it is stored. Returns a reason if the vend needs a human. */
function checkResult(ctx: AppContext, v: VendRow, r: IssueResult): string | null {
  if (r.tokens.length === 0) return 'No token returned';
  const valid = ctx.adapter.mode === 'mock' ? r.tokens.every(isMockToken) : r.tokens.every(isStsTokenDigits);
  if (!valid) return 'Token format not recognised';
  if (v.mode === 'amount' && r.amount && !new Decimal(r.amount).eq(v.amount)) return `Vendor charged ${r.amount}, portal requested ${v.amount}`;
  if (v.mode === 'units' && r.units && !new Decimal(r.units).eq(v.units)) return `Vendor issued ${r.units} kWh, portal requested ${v.units}`;
  return null;
}

/** A customer may only generate tokens for their own meter, and only while their account is active. */
async function checkCustomerMeter(q: Queryable, customerId: string, meterNo: string) {
  const c = (await q.query<{ meter_no: string; active: boolean }>('SELECT meter_no, active FROM customers WHERE id = $1', [customerId])).rows[0];
  if (!c || !c.active) throw new HttpError(403, 'CUSTOMER_INACTIVE', 'This tenant account is not active');
  if (c.meter_no !== meterNo) throw new HttpError(404, 'QUOTE_NOT_FOUND', 'Quote not found');
}

async function storeTokens(ctx: AppContext, q: Queryable, v: VendRow, r: IssueResult, status: VendStatus, actorId: string | null, note?: string) {
  await q.query(
    `UPDATE vends SET status = $2, token_enc = $3, token_last4 = $4, vendor_ref = $5, vendor_code = $6,
            error_message = $7, completed_at = now() WHERE id = $1`,
    [v.id, status, encryptSecret(JSON.stringify(r.tokens), ctx.cfg.TOKEN_ENC_KEY), tokenLast4(r.tokens.at(-1)!), r.vendorRef ?? null, r.vendorCode ?? null, note ?? null],
  );
  await writeAudit(q, {
    actorId,
    action: status === 'SUCCEEDED' ? 'vend.succeeded' : 'vend.needs_review',
    entity: 'vend',
    entityId: v.id,
    detail: { meterNo: v.meter_no, amount: v.amount, units: v.units, tokenCount: r.tokens.length, tokenLast4: tokenLast4(r.tokens.at(-1)!), vendorRef: r.vendorRef, note },
  });
}

export interface CreateVendInput {
  quoteId: string;
  idempotencyKey: string;
  confirmDuplicate: boolean;
  /** Set when a registered customer generates a token for their own meter. */
  customerId?: string;
}

export async function createVend(ctx: AppContext, user: SessionUser, input: CreateVendInput): Promise<VendRow> {
  const { db, cfg } = ctx;

  let reserved: { id: string; replay: boolean };
  try {
    reserved = await db.tx(async (q) => {
      const existing = (
        await q.query<{ id: string; user_id: string; customer_id: string | null }>('SELECT id, user_id, customer_id FROM vends WHERE idempotency_key = $1', [input.idempotencyKey])
      ).rows[0];
      if (existing) {
        if (existing.user_id !== user.id || existing.customer_id !== (input.customerId ?? null)) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used');
        return { id: existing.id, replay: true };
      }

      const quote = (
        await q.query(
          `SELECT id, user_id, meter_no, mode, units::text AS units, amount::text AS amount, currency, tariff_version_id, lines,
                  expires_at > now() AS fresh, consumed_at
             FROM quotes WHERE id = $1 FOR UPDATE`,
          [input.quoteId],
        )
      ).rows[0];
      if (!quote || quote.user_id !== user.id) throw new HttpError(404, 'QUOTE_NOT_FOUND', 'Quote not found');
      if (quote.consumed_at) throw new HttpError(409, 'QUOTE_USED', 'This quote was already used. Get a new quote.');
      if (!quote.fresh) throw new HttpError(409, 'QUOTE_EXPIRED', 'This quote has expired. Get a new quote.');

      const recent = (
        await q.query<{ seconds_ago: number }>(
          `SELECT EXTRACT(EPOCH FROM now() - created_at)::int AS seconds_ago FROM vends
            WHERE meter_no = $1 AND status <> 'FAILED' AND created_at > now() - make_interval(secs => $2)
            ORDER BY created_at DESC LIMIT 1`,
          [quote.meter_no, cfg.METER_COOLDOWN_SECONDS],
        )
      ).rows[0];
      if (recent) {
        const wait = cfg.METER_COOLDOWN_SECONDS - Number(recent.seconds_ago);
        throw new HttpError(409, 'METER_COOLDOWN', `This meter was vended less than ${cfg.METER_COOLDOWN_SECONDS} seconds ago. Wait ${wait} s — the meter rejects two tokens from the same minute.`, { waitSeconds: wait });
      }

      const dup = (
        await q.query(
          `SELECT 1 FROM vends WHERE meter_no = $1 AND amount = $2 AND status IN ('SUCCEEDED', 'UNKNOWN', 'MANUAL_REVIEW')
              AND created_at > now() - make_interval(secs => $3) LIMIT 1`,
          [quote.meter_no, quote.amount, cfg.DUPLICATE_WINDOW_SECONDS],
        )
      ).rows[0];
      if (dup && !(input.confirmDuplicate && isSupervisor(user))) {
        throw new HttpError(409, 'POSSIBLE_DUPLICATE', 'The same amount was vended to this meter a few minutes ago.', {
          requiresSupervisor: !isSupervisor(user),
        });
      }

      await q.query('UPDATE quotes SET consumed_at = now() WHERE id = $1', [quote.id]);
      const id = (
        await q.query<{ id: string }>(
          `INSERT INTO vends (idempotency_key, quote_id, user_id, meter_no, mode, units, amount, currency, lines, tariff_version_id,
                              status, adapter_mode, duplicate_confirmed_by, customer_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', $11, $12, $13) RETURNING id`,
          [input.idempotencyKey, quote.id, user.id, quote.meter_no, quote.mode, quote.units, quote.amount, quote.currency,
            JSON.stringify(quote.lines), quote.tariff_version_id, ctx.adapter.mode, dup ? user.id : null, input.customerId ?? null],
        )
      ).rows[0]!.id;
      if (input.customerId) await checkCustomerMeter(q, input.customerId, quote.meter_no);
      await writeAudit(q, {
        actorId: user.id,
        action: 'vend.requested',
        entity: 'vend',
        entityId: id,
        detail: { meterNo: quote.meter_no, mode: quote.mode, units: quote.units, amount: quote.amount, adapter: ctx.adapter.mode, duplicateConfirmed: Boolean(dup), customerId: input.customerId },
      });
      return { id, replay: false };
    });
  } catch (e) {
    if (isUniqueViolation(e, 'idempotency_key')) {
      const again = (await db.query<{ id: string }>('SELECT id FROM vends WHERE idempotency_key = $1', [input.idempotencyKey])).rows[0];
      if (again) return (await loadVend(db, again.id))!;
    }
    if (isUniqueViolation(e, 'vends_one_open_per_meter_idx')) {
      throw new HttpError(409, 'VEND_IN_PROGRESS', 'Another vend for this meter is still open. A supervisor must resolve it first.');
    }
    throw e;
  }

  const vend = (await loadVend(db, reserved.id))!;
  if (reserved.replay) return vend;
  await submit(ctx, user, vend);
  return (await loadVend(db, reserved.id))!;
}

/** Sends the vend to the STS adapter exactly once. Never retried automatically. */
async function submit(ctx: AppContext, user: SessionUser, v: VendRow) {
  const { db } = ctx;
  await db.query(`UPDATE vends SET status = 'SUBMITTED', submitted_at = now() WHERE id = $1`, [v.id]);
  const started = Date.now();
  try {
    const result = await ctx.adapter.issueCreditToken({
      clientRef: v.client_ref,
      meterNo: v.meter_no,
      by: v.mode === 'amount' ? 'amount' : 'units',
      value: v.mode === 'amount' ? v.amount : v.units,
      currency: v.currency as never,
    });
    const problem = checkResult(ctx, v, result);
    await db.tx(async (q) => {
      await recordAttempt(q, v.id, 'issueCreditToken', problem ? 'needs_review' : 'ok', Date.now() - started);
      await storeTokens(ctx, q, v, result, problem ? 'MANUAL_REVIEW' : 'SUCCEEDED', user.id, problem ?? undefined);
    });
  } catch (e) {
    const latency = Date.now() - started;
    const rejected = e instanceof StsRejectedError;
    const status: VendStatus = rejected ? 'FAILED' : 'UNKNOWN';
    const message = e instanceof StsRejectedError || e instanceof StsUnknownOutcomeError ? e.message : 'Unexpected error while contacting the STS service';
    await db.tx(async (q) => {
      await recordAttempt(q, v.id, 'issueCreditToken', rejected ? 'rejected' : 'unknown', latency, { code: (e as { code?: string }).code });
      await q.query(`UPDATE vends SET status = $2, error_message = $3, completed_at = CASE WHEN $2 = 'FAILED' THEN now() END WHERE id = $1`, [v.id, status, message]);
      await writeAudit(q, { actorId: user.id, action: rejected ? 'vend.failed' : 'vend.unknown', entity: 'vend', entityId: v.id, detail: { meterNo: v.meter_no, message } });
    });
  }
}

/** Asks the adapter whether an UNKNOWN vend produced a token. */
export async function checkVendStatus(ctx: AppContext, actorId: string | null, id: string): Promise<'succeeded' | 'not_found' | 'unsupported' | 'not_open'> {
  const v = await loadVend(ctx.db, id);
  if (!v || !['UNKNOWN', 'MANUAL_REVIEW'].includes(v.status)) return 'not_open';
  const started = Date.now();
  const status = await ctx.adapter.getTransactionStatus(v.client_ref);
  await ctx.db.tx(async (q) => {
    await recordAttempt(q, v.id, 'getTransactionStatus', status.status, Date.now() - started);
    if (status.status === 'succeeded') {
      const problem = checkResult(ctx, v, status.result);
      await storeTokens(ctx, q, v, status.result, problem ? 'MANUAL_REVIEW' : 'SUCCEEDED', actorId, problem ?? 'Recovered by status check');
    }
  });
  return status.status;
}

export interface ResolveInput {
  outcome: 'SUCCEEDED' | 'FAILED';
  note: string;
  /** Token copied by the supervisor from the vendor's own history, when the vend did succeed. */
  token?: string;
}

export async function resolveVend(ctx: AppContext, user: SessionUser, id: string, input: ResolveInput) {
  return ctx.db.tx(async (q) => {
    const v = (await q.query<VendRow>(`${VEND_SELECT} WHERE v.id = $1 FOR UPDATE OF v`, [id])).rows[0];
    if (!v) throw new HttpError(404, 'NOT_FOUND', 'Vend not found');
    if (!['UNKNOWN', 'MANUAL_REVIEW'].includes(v.status)) throw new HttpError(409, 'NOT_OPEN', 'Only UNKNOWN or MANUAL_REVIEW vends can be resolved');

    if (input.outcome === 'SUCCEEDED') {
      if (!v.token_enc && !input.token) throw new HttpError(400, 'TOKEN_REQUIRED', 'Enter the token from the vendor history');
      if (input.token) {
        const ok = ctx.adapter.mode === 'mock' ? isMockToken(input.token) : isStsTokenDigits(input.token);
        if (!ok) throw new HttpError(400, 'INVALID_TOKEN', 'Token must be 20 digits');
      }
    }
    if (input.outcome === 'SUCCEEDED' && input.token) {
      await q.query('UPDATE vends SET token_enc = $2, token_last4 = $3 WHERE id = $1', [
        id,
        encryptSecret(JSON.stringify([input.token.replace(/\s/g, '')]), ctx.cfg.TOKEN_ENC_KEY),
        tokenLast4(input.token),
      ]);
    }
    await q.query(
      `UPDATE vends SET status = $2, resolved_by = $3, resolution_note = $4, completed_at = now() WHERE id = $1`,
      [id, input.outcome, user.id, input.note],
    );
    await writeAudit(q, {
      actorId: user.id,
      action: 'vend.resolved',
      entity: 'vend',
      entityId: id,
      detail: { from: v.status, to: input.outcome, note: input.note, tokenEntered: Boolean(input.token) },
    });
  });
}

/** Background pass: recover UNKNOWN vends via status checks, then hand stale ones to a supervisor. */
export async function sweepUnknownVends(ctx: AppContext) {
  const open = (
    await ctx.db.query<{ id: string; age: number }>(
      `SELECT id, EXTRACT(EPOCH FROM now() - created_at)::int AS age FROM vends WHERE status = 'UNKNOWN' ORDER BY created_at LIMIT 50`,
    )
  ).rows;
  for (const v of open) {
    const result = await checkVendStatus(ctx, null, v.id).catch(() => 'not_found' as const);
    if (result !== 'succeeded' && Number(v.age) > ctx.cfg.UNKNOWN_TO_REVIEW_SECONDS) {
      await ctx.db.tx(async (q) => {
        await q.query(`UPDATE vends SET status = 'MANUAL_REVIEW' WHERE id = $1 AND status = 'UNKNOWN'`, [v.id]);
        await writeAudit(q, { actorId: null, action: 'vend.escalated', entity: 'vend', entityId: v.id, detail: { reason: `status check: ${result}` } });
      });
    }
  }
}
