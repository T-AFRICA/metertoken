'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { api, errorText } from '@/lib/api';
import { formatDate, groupMeter, isSupervisor, money, statusLabel, type Customer, type VendStatus } from '@/lib/types';
import { useSession } from '../session';

interface TokenRow {
  id: string;
  units: string;
  amount: string;
  currency: string;
  status: VendStatus;
  tokenLast4: string | null;
  createdAt: string;
}

interface CustomerRecord {
  month: { count: number; units: string; amount: string; currency: string };
  items: TokenRow[];
}

const EMPTY_FORM = { meterNo: '', name: '', phone: '', pin: '' };

export default function CustomersPage() {
  const me = useSession();
  const manage = isSupervisor(me.user.role);
  const [items, setItems] = useState<Customer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [record, setRecord] = useState<CustomerRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (q = search) =>
    api<{ items: Customer[] }>(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => {
        setItems(r.items);
        setSelected((s) => (s ? r.items.find((c) => c.id === s.id) ?? s : s));
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoaded(true));

  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    setRecord(null);
    setNewPin('');
    setInfo('');
    if (selected) api<CustomerRecord>(`/api/customers/${selected.id}/vends`).then(setRecord).catch(() => undefined);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await fn();
      await load();
      if (done) setInfo(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() => api('/api/customers', { method: 'POST', body: { ...form, phone: form.phone || undefined } }), `${form.name} can now generate tokens with meter ${groupMeter(form.meterNo)} and their PIN.`);
    if (ok) {
      setForm(EMPTY_FORM);
      setShowForm(false);
    }
  }

  async function resetPin(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (await run(() => api(`/api/customers/${selected.id}`, { method: 'PATCH', body: { pin: newPin } }), 'PIN changed. The tenant was signed out everywhere.')) setNewPin('');
  }

  const toggleActive = (c: Customer) =>
    run(() => api(`/api/customers/${c.id}`, { method: 'PATCH', body: { active: !c.active } }), c.active ? 'Tenant deactivated and signed out.' : 'Tenant reactivated.');

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Vending</div>
          <h1>Tenants</h1>
          <p className="subtitle">Registered tenants generate their own tokens with their meter number and PIN, and pay their landlord.</p>
        </div>
        {manage && (
          <button className="ink" onClick={() => setShowForm((v) => !v)}>
            <Icon name={showForm ? 'x' : 'plus'} size={16} /> {showForm ? 'Close' : 'Register tenant'}
          </button>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert ok">{info}</div>}

      {showForm && (
        <form className="card reg-form" onSubmit={register}>
          <h2>Register a tenant</h2>
          <div className="reg-grid">
            <div className="field"><label>Meter number</label><input className="mono" inputMode="numeric" maxLength={13} value={form.meterNo} onChange={(e) => setForm({ ...form, meterNo: e.target.value.replace(/\D/g, '') })} required /></div>
            <div className="field"><label>Tenant name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="field"><label>Phone (optional)</label><input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="field"><label>PIN (4–6 digits)</label><input inputMode="numeric" maxLength={6} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} required /></div>
          </div>
          <p className="hint">Tell the tenant their PIN privately. They sign in at <b>/token</b> (or on the sign-in page) with their meter number and this PIN.</p>
          <button className="primary" disabled={busy}><Icon name="check" size={16} /> Register</button>
        </form>
      )}

      <div className="cust-layout">
        <div className="card flush">
          <div className="card-head">
            <h2>All tenants</h2>
            <div className="input-icon cust-search">
              <Icon name="search" size={16} />
              <input placeholder="Meter, name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr><th>Meter</th><th>Name</th><th>Phone</th><th>Status</th></tr>
              </thead>
              <tbody>
                {!loaded && <SkeletonRows cols={4} rows={3} />}
                {items.map((c) => (
                  <tr key={c.id} className={`clickable ${selected?.id === c.id ? 'picked' : ''}`} onClick={() => setSelected(c)}>
                    <td className="mono" data-label="Meter">{groupMeter(c.meterNo)}</td>
                    <td data-label="Name">{c.name}</td>
                    <td data-label="Phone">{c.phone ?? '—'}</td>
                    <td data-label="Status"><span className={`badge ${c.active ? 'SUCCEEDED' : 'FAILED'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
                {loaded && items.length === 0 && <tr><td colSpan={4} className="empty">{search ? 'No tenant matches that search.' : 'No tenants yet. Register the first one above.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="card cust-panel">
          {!selected ? (
            <div className="cust-empty">
              <Icon name="wallet" size={28} />
              <b>Pick a tenant</b>
              <span>See their tokens, reset their PIN or deactivate them.</span>
            </div>
          ) : (
            <>
              <div className="cust-top">
                <div>
                  <h2>{selected.name}</h2>
                  <span className="mono">{groupMeter(selected.meterNo)}{selected.phone ? ` · ${selected.phone}` : ''}</span>
                </div>
                <span className={`badge ${selected.active ? 'SUCCEEDED' : 'FAILED'}`}>{selected.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="cust-balance">
                <span>This month</span>
                <b>{record ? `${record.month.currency} ${money(record.month.amount)}` : '–'}</b>
                <em>
                  {record ? `${record.month.count} token${record.month.count === 1 ? '' : 's'} · ${money(record.month.units)} kWh` : 'Loading…'}
                  {' · '}
                  {selected.lastLoginAt ? `last signed in ${formatDate(selected.lastLoginAt)}` : 'has not signed in yet'}
                </em>
              </div>

              {manage && (
                <div className="cust-manage">
                  <form onSubmit={resetPin} className="input-group">
                    <input inputMode="numeric" maxLength={6} placeholder="New PIN" aria-label="New PIN, 4 to 6 digits" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
                    <button disabled={busy || newPin.length < 4}>Reset PIN</button>
                  </form>
                  <button className={selected.active ? 'danger-quiet' : ''} onClick={() => toggleActive(selected)} disabled={busy}>
                    {selected.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              )}

              <h2 className="cust-sub">Tokens</h2>
              <ul className="ledger">
                {record?.items.map((t) => (
                  <li key={t.id} className={t.status}>
                    <div>
                      <Link href={`/vends/${t.id}`}><b>{money(t.units)} kWh</b></Link>
                      <span>{formatDate(t.createdAt)}{t.tokenLast4 ? ` · •••• ${t.tokenLast4}` : ''}</span>
                    </div>
                    <div className="num">
                      <b>{t.currency} {money(t.amount)}</b>
                      <span>{statusLabel(t.status)}</span>
                    </div>
                  </li>
                ))}
                {record && record.items.length === 0 && <li className="empty-row">No tokens yet.</li>}
              </ul>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
