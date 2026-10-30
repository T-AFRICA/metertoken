'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { formatDate, statusLabel, type VendStatus } from '@/lib/types';

interface Row {
  id: string;
  reference: string;
  meterNo: string;
  operator: string;
  units: string;
  amount: string;
  currency: string;
  status: VendStatus;
  adapterMode: 'mock' | 'live';
  tokenLast4: string | null;
  createdAt: string;
}

const STATUSES: VendStatus[] = ['SUCCEEDED', 'FAILED', 'UNKNOWN', 'MANUAL_REVIEW', 'PENDING', 'SUBMITTED'];

export default function HistoryPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [meterNo, setMeterNo] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function load(statusFilter = status) {
    const q = new URLSearchParams({ limit: '200' });
    if (statusFilter) q.set('status', statusFilter);
    if (meterNo) q.set('meterNo', meterNo);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    try {
      setRows((await api<{ items: Row[] }>(`/api/vends?${q}`)).items);
      setError('');
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
          <div className="eyebrow">Vending</div>
          <h1>Transactions</h1>
          <p className="subtitle">Every vend, with its status. Click a row for details, receipt and resolution.</p>
        </div>
      </div>
      <div className="card toolbar">
        <div className="field">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Meter</label>
          <input value={meterNo} onChange={(e) => setMeterNo(e.target.value.replace(/\D/g, ''))} maxLength={13} />
        </div>
        <div className="field">
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <button className="primary" onClick={() => load()}>Search</button>
        </div>
        <div className="field">
          <button onClick={() => { setStatus('UNKNOWN'); load('UNKNOWN'); }}>Needs attention</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card flush table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Time</th>
              <th>Meter</th>
              <th>Operator</th>
              <th className="num">kWh</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Token</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => router.push(`/vends/${r.id}`)}>
                <td className="nowrap muted" data-label="Time">{formatDate(r.createdAt)}</td>
                <td className="mono" data-label="Meter">{r.meterNo}</td>
                <td className="nowrap" data-label="Operator">{r.operator}</td>
                <td className="num" data-label="kWh">{r.units}</td>
                <td className="num" data-label="Amount">{r.currency} {r.amount}</td>
                <td data-label="Status">
                  <span className={`badge ${r.status}`}>{statusLabel(r.status)}</span>{' '}
                  {r.adapterMode === 'mock' && <span className="badge mock">MOCK</span>}
                </td>
                <td className="mono" data-label="Token">{r.tokenLast4 ? `•••• ${r.tokenLast4}` : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">No transactions found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
