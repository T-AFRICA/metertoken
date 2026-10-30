'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Bars, Stat, type Bar } from '@/components/Stat';
import { api, errorText } from '@/lib/api';
import { statusLabel } from '@/lib/types';

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
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kwh = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

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
  const currency = rows[0]?.currency ?? '';

  // One bar per day of the period (gaps filled with zero), or only the days with sales for long periods.
  const perDay = new Map<string, number>();
  for (const r of ok) perDay.set(r.day, (perDay.get(r.day) ?? 0) + Number(r.amount));
  const days = [...perDay.keys()].sort();
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const range =
    span > 0 && span <= 62
      ? Array.from({ length: span }, (_, i) => new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10))
      : days;
  const chart: Bar[] = range.map((d) => {
    const label = new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const value = perDay.get(d) ?? 0;
    return { label, value, tip: `${label} · ${currency} ${money(value)}` };
  });
  const peak = chart.reduce<Bar | undefined>((a, b) => (b.value > (a?.value ?? 0) ? b : a), undefined);

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
        <div className="field"><button className="ink" onClick={load}>Show</button></div>
        <div className="field">
          <a className="button" href={`/api/admin/reports/export.csv?from=${from}&to=${to}`}><Icon name="download" size={16} /> Export CSV</a>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="grid4">
        <Stat icon="bolt" label="Successful vends" value={count} note={`${days.length} day${days.length === 1 ? '' : 's'} with sales`} />
        <Stat icon="chart" label="Sales" prefix={currency} value={money(total)} note={count ? `Avg ${currency} ${money(total / count)} per token` : 'No sales in this period'} />
        <Stat icon="meter" label="Units sold" suffix="kWh" value={kwh(units)} note={count ? `Avg ${kwh(units / count)} kWh per token` : 'No units in this period'} />
        <Stat
          icon={attention ? 'alert' : 'check'}
          label="Needing attention"
          tone={attention ? 'warn' : 'ok'}
          value={attention}
          note={attention ? 'Open Transactions to resolve' : 'All clear'}
        />
      </div>
      {chart.length > 1 && (
        <div className="card chart-card">
          <div className="chart-head">
            <div>
              <h2>Daily sales</h2>
              <p className="hint">Successful vends per day, in {currency}. Hover a bar for the figure.</p>
            </div>
            {peak && (
              <div className="peak">
                <span>Best day</span>
                <b>{currency} {money(peak.value)}</b>
                <em>{peak.label}</em>
              </div>
            )}
          </div>
          <Bars bars={chart} height={180} labelEvery={Math.ceil(chart.length / 10)} />
        </div>
      )}
      <div className="card flush table-wrap">
        <table className="stack">
          <thead>
            <tr><th>Day</th><th>Operator</th><th>Status</th><th className="num">Count</th><th className="num">kWh</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td data-label="Day">{r.day}</td>
                <td data-label="Operator">{r.operator}</td>
                <td data-label="Status"><span className={`badge ${r.status}`}>{statusLabel(r.status)}</span></td>
                <td className="num" data-label="Count">{r.count}</td>
                <td className="num" data-label="kWh">{r.units}</td>
                <td className="num" data-label="Amount">{r.currency} {Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
