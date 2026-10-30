import type { Db, Queryable } from './db';
import { redact, sha256 } from './security';

export interface AuditEvent {
  actorId: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  detail?: Record<string, unknown>;
}

const GENESIS = '0'.repeat(64);
// Serialises writers so the hash chain stays linear.
const AUDIT_LOCK_KEY = 734_100;

/** Must run inside a transaction (the advisory lock is transaction-scoped). */
export async function writeAudit(q: Queryable, e: AuditEvent): Promise<void> {
  await q.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);
  const prev = (await q.query<{ hash: string }>('SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1')).rows[0]?.hash ?? GENESIS;
  const at = new Date().toISOString();
  const detail = e.detail ? redact(e.detail) : null;
  const payload = JSON.stringify({ at, actorId: e.actorId, action: e.action, entity: e.entity ?? null, entityId: e.entityId ?? null, detail });
  const hash = sha256(prev + payload);
  await q.query(
    `INSERT INTO audit_events (at, actor_id, action, entity, entity_id, detail, payload, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [at, e.actorId, e.action, e.entity ?? null, e.entityId ?? null, detail, payload, prev, hash],
  );
}

export const audit = (db: Db, e: AuditEvent) => db.tx((q) => writeAudit(q, e));

/** Recomputes the chain; returns the first broken event id, if any. */
export async function verifyAuditChain(db: Queryable): Promise<{ ok: boolean; checked: number; brokenAtId?: string }> {
  const rows = (await db.query<{ id: string; payload: string; prev_hash: string; hash: string }>(
    'SELECT id::text AS id, payload, prev_hash, hash FROM audit_events ORDER BY audit_events.id',
  )).rows;
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || sha256(prev + r.payload) !== r.hash) return { ok: false, checked: rows.length, brokenAtId: r.id };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
