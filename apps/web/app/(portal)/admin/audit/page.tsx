'use client';

import { useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { api, errorText } from '@/lib/api';
import { formatDate } from '@/lib/types';

interface Event {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: Record<string, unknown> | null;
}

interface Chain {
  ok: boolean;
  checked: number;
  brokenAtId?: string;
}

const ACTION_TONE: Record<string, string> = {
  'vend.succeeded': 'SUCCEEDED',
  'vend.failed': 'FAILED',
  'vend.unknown': 'UNKNOWN',
  'vend.needs_review': 'UNKNOWN',
  'vend.escalated': 'UNKNOWN',
  'auth.login_failed': 'FAILED',
  'customer.login_failed': 'FAILED',
  'customer.registered': 'SUCCEEDED',
};

const ACTION_LABEL: Record<string, string> = {
  'vend.requested': 'Vend requested',
  'customer.registered': 'Customer registered',
  'customer.updated': 'Customer changed',
  'customer.login': 'Customer signed in',
  'customer.login_failed': 'Customer sign-in failed',
  'customer.token_viewed': 'Customer viewed token',
  'vend.succeeded': 'Token issued',
  'vend.failed': 'Vend failed',
  'vend.unknown': 'Result unknown',
  'vend.needs_review': 'Needs review',
  'vend.escalated': 'Escalated',
  'vend.resolved': 'Resolved',
  'vend.token_viewed': 'Token viewed',
  'receipt.printed': 'Receipt printed',
  'receipt.reprinted': 'Receipt reprinted',
  'meter.verify': 'Meter checked',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Sign-in failed',
  'user.bootstrap_admin': 'First admin created',
  'user.created': 'User added',
  'user.updated': 'User changed',
  'tariff.sample_seeded': 'Sample tariff added',
  'tariff.created': 'Tariff added',
  'tariff.version_drafted': 'Tariff drafted',
  'tariff.version_approved': 'Tariff approved',
  'report.exported': 'Report exported',
  'live_mode.approved': 'Live mode approved',
  'live_mode.revoked': 'Live mode revoked',
};

const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());

// camelCase keys read as words; long decimals from the database are trimmed.
const keyLabel = (k: string) => k.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
const valueText = (v: unknown) => {
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return /^\d+\.\d{3,}$/.test(s) ? Number(s).toFixed(2) : s;
};

function Detail({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail) return <span className="muted">—</span>;
  const entries = Object.entries(detail).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <>
      {entries.map(([k, v]) => (
        <span key={k} className="chip" title={`${k}: ${valueText(v)}`}>
          <b>{keyLabel(k)}</b> {valueText(v)}
        </span>
      ))}
    </>
  );
}

export default function AuditPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [chain, setChain] = useState<Chain | null>(null);

  async function load(prefix = action) {
    try {
      const q = new URLSearchParams({ limit: '300' });
      if (prefix) q.set('action', prefix);
      setEvents((await api<{ items: Event[] }>(`/api/admin/audit?${q}`)).items);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Security</div>
          <h1>Activity log</h1>
          <p className="subtitle">Every sign-in, vend, tariff and user change. Entries are hash-chained and cannot be edited.</p>
        </div>
        <button onClick={() => api<Chain>('/api/admin/audit/verify').then(setChain).catch((e) => setError(errorText(e)))}>
          <Icon name="shield" size={16} /> Verify tamper-evidence
        </button>
      </div>

      {chain && (
        <div className={`alert ${chain.ok ? 'ok' : 'error'}`}>
          <Icon name={chain.ok ? 'check' : 'alert'} size={16} />
          {chain.ok ? `Hash chain intact — ${chain.checked} events checked.` : `Hash chain BROKEN at event ${chain.brokenAtId}. Investigate immediately.`}
        </div>
      )}
      {error && <div className="alert error"><Icon name="alert" size={16} /> {error}</div>}

      <div className="card flush">
        <div className="card-head">
          <div className="segmented">
            {[['', 'All'], ['vend.', 'Vends'], ['auth.', 'Sign-ins'], ['tariff.', 'Tariffs'], ['customer.', 'Customers'], ['user.', 'Users'], ['receipt.', 'Receipts']].map(([p, label]) => (
              <button key={p} className={action === p ? 'on' : ''} onClick={() => { setAction(p!); load(p); }}>{label}</button>
            ))}
          </div>
          <span className="hint">{events.length} events</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Time</th><th>User</th><th>Action</th><th>Object</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {!loaded && <SkeletonRows cols={5} />}
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap muted">{formatDate(e.at)}</td>
                  <td className="nowrap">{e.actor === 'system' && e.action.startsWith('customer.') ? 'Customer' : e.actor}</td>
                  <td className="nowrap">
                    <span className={`badge ${ACTION_TONE[e.action] ?? 'PENDING'}`}>{actionLabel(e.action)}</span>
                  </td>
                  <td className="nowrap mono muted">{e.entity ? `${e.entity} ${(e.entityId ?? '').slice(0, 11)}` : '—'}</td>
                  <td><Detail detail={e.detail} /></td>
                </tr>
              ))}
              {loaded && events.length === 0 && (
                <tr><td colSpan={5} className="empty">No events of this kind yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
