'use client';

import { useEffect, useState } from 'react';
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
          <h2 style={{ marginTop: 0 }}>STS connection</h2>
          <p>
            Current mode: <b>{live.currentMode.toUpperCase()}</b>
            {live.currentMode === 'mock' && ' — tokens are not valid on meters.'}
          </p>
          <p className="hint">Live mode needs ALL of the following, then an API restart:</p>
          <ol>
            <li>Written authorization and a vend-only API account from the vendor.</li>
            <li>HTTPS or a VPN route to the vendor API (configured on the server).</li>
            <li>
              Server settings <code>STS_MODE=live</code> and <code>STS_LIVE_ENABLED=true</code> (now: {live.requestedMode}, {live.envEnabled ? 'enabled' : 'disabled'}).
            </li>
            <li>Approval by two different admins below (now: {live.approvals.length} of 2).</li>
          </ol>
          {live.approvals.length > 0 && (
            <ul>
              {live.approvals.map((a) => (
                <li key={a.admin}>
                  {a.admin} approved on {formatDate(a.approved_at)}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button
              className="primary"
              onClick={() =>
                run('/api/admin/live-mode/approve', 'Approve live STS vending? Only do this after the vendor has authorized Tronic in writing.')
              }
            >
              Approve live mode
            </button>
            <button className="danger" onClick={() => run('/api/admin/live-mode/revoke', 'Revoke all approvals? Live vending stops immediately.')}>
              Revoke all approvals
            </button>
          </div>
        </div>
      )}
    </>
  );
}
