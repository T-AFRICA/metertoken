'use client';

import { useEffect, useState } from 'react';
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

export default function AuditPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [chain, setChain] = useState<{ ok: boolean; checked: number; brokenAtId?: string } | null>(null);

  async function load() {
    try {
      const q = new URLSearchParams({ limit: '300' });
      if (action) q.set('action', action);
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
      <h1>Activity log</h1>
      <div className="card row">
        <div className="field">
          <label>Action starts with</label>
          <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="vend. / auth. / tariff." />
        </div>
        <div className="field"><button className="primary" onClick={load}>Filter</button></div>
        <div className="field">
          <button onClick={() => api<typeof chain>('/api/admin/audit/verify').then(setChain).catch((e) => setError(errorText(e)))}>
            Verify tamper-evidence
          </button>
        </div>
      </div>
      {chain && (
        <div className={`alert ${chain.ok ? 'ok' : 'error'}`}>
          {chain.ok ? `Hash chain intact (${chain.checked} events checked).` : `Hash chain BROKEN at event ${chain.brokenAtId}. Investigate immediately.`}
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>User</th><th>Action</th><th>Object</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.at)}</td>
                <td>{e.actor}</td>
                <td className="mono">{e.action}</td>
                <td className="mono">{e.entity ? `${e.entity}:${(e.entityId ?? '').slice(0, 13)}` : '—'}</td>
                <td className="mono" style={{ fontSize: '0.8rem' }}>{e.detail ? JSON.stringify(e.detail) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
