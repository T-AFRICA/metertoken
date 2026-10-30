'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
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
      <div className="page-head">
        <div>
          <div className="eyebrow">Management</div>
          <h1>Reports</h1>
          <p className="subtitle">Sales, units and exceptions for a period. Exports never include full tokens.</p>
        </div>
      </div>
      <div className="card toolbar">
        <div className="field"><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="field"><button className="primary" onClick={load}>Show</button></div>
        <div className="field">
          <a className="button primary" href={`/api/admin/reports/export.csv?from=${from}&to=${to}`}><Icon name="download" size={16} /> Export CSV</a>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="grid4">
        <div className="stat"><div className="k"><Icon name="bolt" size={16} /> Successful vends</div><div className="v">{count}</div></div>
        <div className="stat"><div className="k"><Icon name="chart" size={16} /> Sales</div><div className="v">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
        <div className="stat"><div className="k"><Icon name="meter" size={16} /> Units sold (kWh)</div><div className="v">{units.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
        <div className={`stat ${attention ? 'warn' : ''}`}><div className="k"><Icon name="alert" size={16} /> Needing attention</div><div className="v">{attention}</div></div>
      </div>
      <div className="card flush table-wrap">
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
            {rows.length === 0 && <tr><td colSpan={6} className="empty">No data for this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">The CSV export never contains full tokens — only the last four digits.</p>
    </>
  );
}
