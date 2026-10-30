'use client';

import { useEffect, useState } from 'react';
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
};

function Detail({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail) return <span className="muted">—</span>;
  const entries = Object.entries(detail).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <>
      {entries.map(([k, v]) => (
        <span key={k} className="chip" title={`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`}>
          <b>{k}</b> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </>
  );
}

export default function AuditPage() {
  const [events, setEvents] = useState<Event[]>([]);
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
            {[['', 'All'], ['vend.', 'Vends'], ['auth.', 'Sign-ins'], ['tariff.', 'Tariffs'], ['user.', 'Users'], ['receipt.', 'Receipts']].map(([p, label]) => (
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
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap muted">{formatDate(e.at)}</td>
                  <td className="nowrap">{e.actor}</td>
                  <td className="nowrap">
                    <span className={`badge ${ACTION_TONE[e.action] ?? 'PENDING'}`}>{e.action}</span>
                  </td>
                  <td className="nowrap mono muted">{e.entity ? `${e.entity} ${(e.entityId ?? '').slice(0, 11)}` : '—'}</td>
                  <td><Detail detail={e.detail} /></td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={5} className="empty">No events.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
