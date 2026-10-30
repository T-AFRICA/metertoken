'use client';

import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { formatDate, statusLabel } from '@/lib/types';
import { useSession } from '../../session';

interface Charge {
  name: string;
  percent?: string;
  amount?: string;
}

interface Version {
  id: string;
  baseRate: string;
  percentCharges: Charge[];
  fixedCharges: Charge[];
  status: 'draft' | 'active' | 'retired';
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
}

interface Tariff {
  id: string;
  code: string;
  name: string;
  currency: string;
  versions: Version[];
}

const emptyDraft = { baseRate: '', percent: [{ name: 'VAT', percent: '' }], fixed: [] as { name: string; amount: string }[], note: '' };

export default function TariffsPage() {
  const me = useSession();
  const isAdmin = me.user.role === 'admin';
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [error, setError] = useState('');
  const [newTariff, setNewTariff] = useState({ code: '', name: '', currency: me.currency });
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);

  const load = () => api<{ items: Tariff[] }>('/api/admin/tariffs').then((r) => setTariffs(r.items)).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() =>
      api(`/api/admin/tariffs/${draftFor}/versions`, {
        method: 'POST',
        body: {
          baseRate: draft.baseRate,
          percentCharges: draft.percent.filter((c) => c.name && c.percent),
          fixedCharges: draft.fixed.filter((c) => c.name && c.amount),
          note: draft.note || undefined,
        },
      }),
    );
    if (ok) {
      setDraftFor(null);
      setDraft(emptyDraft);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Management</div>
          <h1>Tariffs</h1>
          <p className="subtitle">A new version stays a draft until a different admin approves it. The portal price is checked against the vendor result on every vend.</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      {tariffs.map((t) => (
        <div className="card" key={t.id}>
          <h2 style={{ marginTop: 0 }}>
            {t.code} · {t.name} <span className="hint">({t.currency})</span>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Status</th><th className="num">Rate / kWh</th><th>Charges</th><th>Created</th><th>Approved by</th><th /></tr>
              </thead>
              <tbody>
                {t.versions.map((v) => (
                  <tr key={v.id}>
                    <td><span className={`badge ${v.status}`}>{statusLabel(v.status)}</span></td>
                    <td className="num">{v.baseRate}</td>
                    <td>
                      {[...v.percentCharges.map((c) => `${c.name} ${c.percent}%`), ...v.fixedCharges.map((c) => `${c.name} ${c.amount}`)].join(', ') || '—'}
                      {v.note && <div className="hint">{v.note}</div>}
                    </td>
                    <td className="nowrap muted">{v.createdBy ?? 'system'} · {formatDate(v.createdAt)}</td>
                    <td>{v.approvedBy ?? '—'}</td>
                    <td>
                      {isAdmin && v.status === 'draft' && (
                        <button onClick={() => run(() => api(`/api/admin/tariff-versions/${v.id}/approve`, { method: 'POST' }))}>Approve</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isAdmin && draftFor !== t.code && <button onClick={() => setDraftFor(t.code)}>New version</button>}
          {isAdmin && draftFor === t.code && (
            <form onSubmit={saveDraft} style={{ marginTop: '1rem' }}>
              <div className="field">
                <label>Rate per kWh ({t.currency})</label>
                <input value={draft.baseRate} onChange={(e) => setDraft({ ...draft, baseRate: e.target.value })} required inputMode="decimal" />
              </div>
              <label><b>Percentage charges</b> (of the energy charge)</label>
              {draft.percent.map((c, i) => (
                <div className="row" key={i}>
                  <input placeholder="Name" value={c.name} onChange={(e) => setDraft({ ...draft, percent: draft.percent.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input placeholder="%" value={c.percent} onChange={(e) => setDraft({ ...draft, percent: draft.percent.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)) })} inputMode="decimal" />
                </div>
              ))}
              <button type="button" onClick={() => setDraft({ ...draft, percent: [...draft.percent, { name: '', percent: '' }] })}>+ Percentage charge</button>
              <div style={{ marginTop: '0.75rem' }}><label><b>Fixed charges</b> (per vend)</label></div>
              {draft.fixed.map((c, i) => (
                <div className="row" key={i}>
                  <input placeholder="Name" value={c.name} onChange={(e) => setDraft({ ...draft, fixed: draft.fixed.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input placeholder="Amount" value={c.amount} onChange={(e) => setDraft({ ...draft, fixed: draft.fixed.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} inputMode="decimal" />
                </div>
              ))}
              <button type="button" onClick={() => setDraft({ ...draft, fixed: [...draft.fixed, { name: '', amount: '' }] })}>+ Fixed charge</button>
              <div className="field" style={{ marginTop: '0.75rem' }}>
                <label>Note (source of the tariff, e.g. regulator notice)</label>
                <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </div>
              <div className="row">
                <button className="primary">Save draft</button>
                <button type="button" onClick={() => setDraftFor(null)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      ))}

      {isAdmin && (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api('/api/admin/tariffs', { method: 'POST', body: newTariff }))) setNewTariff({ code: '', name: '', currency: me.currency });
          }}
        >
          <h2 style={{ marginTop: 0 }}>Add tariff</h2>
          <div className="row">
            <div className="field"><label>Code</label><input value={newTariff.code} onChange={(e) => setNewTariff({ ...newTariff, code: e.target.value.toUpperCase() })} required placeholder="DEFAULT" /></div>
            <div className="field"><label>Name</label><input value={newTariff.name} onChange={(e) => setNewTariff({ ...newTariff, name: e.target.value })} required /></div>
            <div className="field">
              <label>Currency</label>
              <select value={newTariff.currency} onChange={(e) => setNewTariff({ ...newTariff, currency: e.target.value })}>
                {['KES', 'TZS', 'UGX', 'RWF'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field"><button className="primary">Add</button></div>
          </div>
        </form>
      )}
    </>
  );
}
