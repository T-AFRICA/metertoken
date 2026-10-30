'use client';

import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';

interface Row {
  day: string;
  operator: string;
  status: string;
  currency: string;
  count: number;
  units: string;
  amount: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      setRows((await api<{ rows: Row[] }>(`/api/admin/reports/summary?from=${from}&to=${to}`)).rows);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ok = rows.filter((r) => r.status === 'SUCCEEDED');
  const total = ok.reduce((s, r) => s + Number(r.amount), 0);
  const units = ok.reduce((s, r) => s + Number(r.units), 0);
  const count = ok.reduce((s, r) => s + r.count, 0);
  const attention = rows.filter((r) => r.status === 'UNKNOWN' || r.status === 'MANUAL_REVIEW').reduce((s, r) => s + r.count, 0);

  return (
    <>
      <h1>Reports</h1>
      <div className="card row">
        <div className="field"><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="field"><button className="primary" onClick={load}>Show</button></div>
        <div className="field">
          <a className="button" href={`/api/admin/reports/export.csv?from=${from}&to=${to}`}>Export CSV</a>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="grid2">
        <div className="card"><div className="hint">Successful vends</div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{count}</div></div>
        <div className="card"><div className="hint">Sales (successful)</div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
        <div className="card"><div className="hint">Units sold (kWh)</div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{units.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
        <div className="card"><div className="hint">Needing attention</div><div style={{ fontSize: '1.6rem', fontWeight: 700, color: attention ? 'var(--warn)' : undefined }}>{attention}</div></div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Day</th><th>Operator</th><th>Status</th><th className="num">Count</th><th className="num">kWh</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.day}</td>
                <td>{r.operator}</td>
                <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                <td className="num">{r.count}</td>
                <td className="num">{r.units}</td>
                <td className="num">{r.currency} {r.amount}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="hint">No data for this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">The CSV export never contains full tokens — only the last four digits.</p>
    </>
  );
}
