'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Receipt } from '@/components/Receipt';
import { api, errorText } from '@/lib/api';
import { formatDate, isSupervisor, statusLabel, type Vend } from '@/lib/types';
import { useSession } from '../../session';

export default function VendDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useSession();
  const [vend, setVend] = useState<Vend | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [outcome, setOutcome] = useState<'SUCCEEDED' | 'FAILED'>('FAILED');
  const [note, setNote] = useState('');
  const [token, setToken] = useState('');

  const load = useCallback(() => {
    api<Vend>(`/api/vends/${id}`).then(setVend).catch((e) => setError(errorText(e)));
  }, [id]);
  useEffect(load, [load]);

  async function reprint() {
    try {
      await api(`/api/vends/${id}/print`, { method: 'POST', body: { reprint: true } });
      window.print();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function checkStatus() {
    setInfo('');
    try {
      const r = await api<{ result: string }>(`/api/vends/${id}/check-status`, { method: 'POST' });
      setInfo(
        r.result === 'unsupported'
          ? 'The vendor API has no status check. Look up this meter in the vendor system, or ask the customer to read the last tokens on the meter (short code 50).'
          : `Status check: ${r.result}`,
      );
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function resolve(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      setVend(await api<Vend>(`/api/vends/${id}/resolve`, { method: 'POST', body: { outcome, note, token: token || undefined } }));
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (error && !vend) return <div className="alert error">{error}</div>;
  if (!vend) return <p className="hint">Loading…</p>;
  const open = vend.status === 'UNKNOWN' || vend.status === 'MANUAL_REVIEW';

  return (
    <>
    <div className="page-head no-print">
      <div>
        <Link href="/history" className="back-link"><Icon name="back" size={14} /> Transactions</Link>
        <div className="eyebrow">Ref {vend.reference.slice(0, 8).toUpperCase()}</div>
        <h1 className="title-row">
          Transaction <span className={`badge ${vend.status}`}>{statusLabel(vend.status)}</span>
        </h1>
      </div>
      {vend.status === 'SUCCEEDED' && vend.tokens && (
        <button className="primary" onClick={reprint}><Icon name="printer" size={16} /> Reprint receipt</button>
      )}
    </div>
    <div className="grid2">
      <div className="card no-print">
        <h2>Details</h2>
        <table className="breakdown">
          <tbody>
            <tr><td>Reference</td><td className="mono">{vend.reference}</td></tr>
            <tr><td>Created</td><td>{formatDate(vend.createdAt)}</td></tr>
            <tr><td>Operator</td><td>{vend.operator}</td></tr>
            <tr><td>Meter</td><td className="mono">{vend.meterNo}</td></tr>
            <tr><td>Units / amount</td><td>{vend.units} kWh · {vend.currency} {Number(vend.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
            <tr><td>Mode</td><td>{vend.adapterMode === 'mock' ? <span className="badge mock">Test token</span> : 'Live'}</td></tr>
            {vend.errorMessage && <tr><td>Message</td><td>{vend.errorMessage}</td></tr>}
            {vend.resolutionNote && <tr><td>Resolution</td><td>{vend.resolutionNote}</td></tr>}
            {!vend.tokens && vend.tokenLast4 && <tr><td>Token</td><td className="mono">•••• {vend.tokenLast4} (hidden)</td></tr>}
          </tbody>
        </table>
        {error && <div className="alert error">{error}</div>}
        {info && <div className="alert warn">{info}</div>}

        {open && isSupervisor(me.user.role) && (
          <>
            <h2>Resolve</h2>
            <p className="hint">Check the vendor system first. Never generate a new token until this is resolved.</p>
            <button onClick={checkStatus}>Check status with vendor</button>
            <form onSubmit={resolve} style={{ marginTop: '1rem' }}>
              <div className="field">
                <label>Outcome</label>
                <select value={outcome} onChange={(e) => setOutcome(e.target.value as 'SUCCEEDED' | 'FAILED')}>
                  <option value="FAILED">No token was issued (FAILED)</option>
                  <option value="SUCCEEDED">Token was issued (SUCCEEDED)</option>
                </select>
              </div>
              {outcome === 'SUCCEEDED' && !vend.tokens && (
                <div className="field">
                  <label>Token from vendor records</label>
                  <input className="mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="20 digits" />
                </div>
              )}
              <div className="field">
                <label>Note (what you checked)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} minLength={5} required rows={3} />
              </div>
              <button className="primary">Save resolution</button>
            </form>
          </>
        )}
      </div>
      {vend.status === 'SUCCEEDED' && vend.tokens && (
        <div className="receipt-stage">
          <Receipt vend={vend} reprint />
        </div>
      )}
    </div>
    </>
  );
}
