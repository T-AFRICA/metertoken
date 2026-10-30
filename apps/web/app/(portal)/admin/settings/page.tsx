'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, errorText } from '@/lib/api';
import { formatDate } from '@/lib/types';

interface LiveMode {
  currentMode: 'mock' | 'live';
  requestedMode: 'mock' | 'live';
  envEnabled: boolean;
  approvals: { admin: string; approved_at: string }[];
}

export default function SettingsPage() {
  const [live, setLive] = useState<LiveMode | null>(null);
  const [error, setError] = useState('');
  const load = () => api<LiveMode>('/api/admin/live-mode').then(setLive).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  async function run(path: string, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    try {
      await api(path, { method: 'POST' });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Management</div>
          <h1>Settings</h1>
          <p className="subtitle">Connection to the vendor STS service.</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {live && (
        <div className="card">
          <div className="summary-head">
            <h2>STS connection</h2>
            <span className={`mode-pill ${live.currentMode}`}>{live.currentMode === 'mock' ? 'Test mode' : 'Live'}</span>
          </div>
          <p className="hint" style={{ margin: '0.25rem 0 1.25rem' }}>
            {live.currentMode === 'mock'
              ? 'Tokens issued now are practice tokens and will not load on a meter. Live vending needs every step below, then an API restart.'
              : 'Connected to the vendor. Revoking approvals stops live vending immediately.'}
          </p>
          <ul className="checklist">
            {[
              { done: null, title: 'Vendor authorization', detail: 'Written permission and a vend-only API account from the vendor. Checked offline.' },
              { done: null, title: 'Secure route to the vendor', detail: 'HTTPS or a VPN to the vendor API, configured on the server.' },
              {
                done: live.requestedMode === 'live' && live.envEnabled,
                title: 'Server settings',
                detail: (
                  <>
                    <code>STS_MODE=live</code> and <code>STS_LIVE_ENABLED=true</code> — now {live.requestedMode}, {live.envEnabled ? 'enabled' : 'disabled'}.
                  </>
                ),
              },
              {
                done: live.approvals.length >= 2,
                title: `Two admin approvals (${live.approvals.length} of 2)`,
                detail: live.approvals.length
                  ? live.approvals.map((a) => `${a.admin} on ${formatDate(a.approved_at)}`).join(' · ')
                  : 'Two different admins must approve below.',
              },
            ].map((s) => (
              <li key={s.title} className={s.done ? 'done' : s.done === null ? 'manual' : ''}>
                <span className="tick">{s.done ? <Icon name="check" size={14} /> : null}</span>
                <div>
                  <b>{s.title}</b>
                  <div className="hint">{s.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="row" style={{ marginTop: '1.25rem' }}>
            <button
              className="ink"
              onClick={() =>
                run('/api/admin/live-mode/approve', 'Approve live STS vending? Only do this after the vendor has authorized Tronic in writing.')
              }
            >
              <Icon name="shield" size={16} /> Approve live mode
            </button>
            {live.approvals.length > 0 && (
              <button className="danger-quiet" onClick={() => run('/api/admin/live-mode/revoke', 'Revoke all approvals? Live vending stops immediately.')}>
                Revoke all approvals
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
