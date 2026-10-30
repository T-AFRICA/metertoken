'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, errorText } from '@/lib/api';
import { canVend, formatDate, groupMeter, isSupervisor, money, type Customer } from '@/lib/types';
import { useSession } from '../session';

interface LedgerRow {
  id: string;
  kind: 'topup' | 'purchase' | 'refund';
  amount: string;
  balanceAfter: string;
  note: string | null;
  by: string | null;
  createdAt: string;
}

const KIND_LABEL = { topup: 'Top-up', purchase: 'Token bought', refund: 'Refund' } as const;
const EMPTY_FORM = { meterNo: '', name: '', phone: '', pin: '' };

export default function CustomersPage() {
  const me = useSession();
  const manage = isSupervisor(me.user.role);
  const topUpAllowed = canVend(me.user.role);
  const [items, setItems] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const topUpKey = useRef('');

  const load = (q = search) =>
    api<{ items: Customer[] }>(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => {
        setItems(r.items);
        setSelected((s) => (s ? r.items.find((c) => c.id === s.id) ?? s : s));
      })
      .catch((e) => setError(errorText(e)));

  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    setLedger([]);
    setAmount('');
    setNote('');
    setNewPin('');
    setInfo('');
    topUpKey.current = crypto.randomUUID();
    if (selected) api<{ items: LedgerRow[] }>(`/api/customers/${selected.id}/ledger`).then((r) => setLedger(r.items)).catch(() => undefined);
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
    const ok = await run(() => api('/api/customers', { method: 'POST', body: { ...form, phone: form.phone || undefined } }), `${form.name} can now buy tokens with meter ${groupMeter(form.meterNo)} and their PIN.`);
    if (ok) {
      setForm(EMPTY_FORM);
      setShowForm(false);
    }
  }

  async function topUp(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const ok = await run(
      () => api(`/api/customers/${selected.id}/topups`, { method: 'POST', body: { amount, note: note || undefined }, headers: { 'idempotency-key': topUpKey.current } }),
      `Added ${me.currency} ${money(amount)} to ${selected.name}'s balance.`,
    );
    if (ok) {
      topUpKey.current = crypto.randomUUID();
      setAmount('');
      setNote('');
      api<{ items: LedgerRow[] }>(`/api/customers/${selected.id}/ledger`).then((r) => setLedger(r.items));
    }
  }

  async function resetPin(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (await run(() => api(`/api/customers/${selected.id}`, { method: 'PATCH', body: { pin: newPin } }), 'PIN changed. The customer was signed out everywhere.')) setNewPin('');
  }

  const toggleActive = (c: Customer) =>
    run(() => api(`/api/customers/${c.id}`, { method: 'PATCH', body: { active: !c.active } }), c.active ? 'Customer deactivated and signed out.' : 'Customer reactivated.');

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Vending</div>
          <h1>Customers</h1>
          <p className="subtitle">Registered customers buy their own tokens from a balance you top up here after taking payment.</p>
        </div>
        {manage && (
          <button className="ink" onClick={() => setShowForm((v) => !v)}>
            <Icon name={showForm ? 'x' : 'plus'} size={16} /> {showForm ? 'Close' : 'Register customer'}
          </button>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert ok">{info}</div>}

      {showForm && (
        <form className="card reg-form" onSubmit={register}>
          <h2>Register a customer</h2>
          <div className="reg-grid">
            <div className="field"><label>Meter number</label><input className="mono" inputMode="numeric" maxLength={13} value={form.meterNo} onChange={(e) => setForm({ ...form, meterNo: e.target.value.replace(/\D/g, '') })} required /></div>
            <div className="field"><label>Customer name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="field"><label>Phone (optional)</label><input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="field"><label>PIN (4–6 digits)</label><input inputMode="numeric" maxLength={6} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} required /></div>
          </div>
          <p className="hint">Tell the customer their PIN privately. They sign in at <b>/token</b> (or on the sign-in page) with their meter number and this PIN.</p>
          <button className="primary" disabled={busy}><Icon name="check" size={16} /> Register</button>
        </form>
      )}

      <div className="cust-layout">
        <div className="card flush">
          <div className="card-head">
            <h2>All customers</h2>
            <div className="input-icon cust-search">
              <Icon name="search" size={16} />
              <input placeholder="Meter, name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr><th>Meter</th><th>Name</th><th className="num">Balance</th><th>Status</th></tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className={`clickable ${selected?.id === c.id ? 'picked' : ''}`} onClick={() => setSelected(c)}>
                    <td className="mono" data-label="Meter">{groupMeter(c.meterNo)}</td>
                    <td data-label="Name">{c.name}</td>
                    <td className="num" data-label="Balance">{c.currency} {money(c.balance)}</td>
                    <td data-label="Status"><span className={`badge ${c.active ? 'SUCCEEDED' : 'FAILED'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={4} className="empty">{search ? 'No customer matches that search.' : 'No customers yet. Register the first one above.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="card cust-panel">
          {!selected ? (
            <div className="cust-empty">
              <Icon name="wallet" size={28} />
              <b>Pick a customer</b>
              <span>Top up their balance, reset their PIN or see their history.</span>
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
                <span>Balance</span>
                <b>{selected.currency} {money(selected.balance)}</b>
                <em>{selected.lastLoginAt ? `Last signed in ${formatDate(selected.lastLoginAt)}` : 'Has not signed in yet'}</em>
              </div>

              {topUpAllowed && selected.active && (
                <form onSubmit={topUp} className="cust-form">
                  <label className="label">Top up after taking payment</label>
                  <div className="input-group">
                    <div className="input-affix">
                      <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} required />
                      <span>{selected.currency}</span>
                    </div>
                    <button className="primary" disabled={busy || !amount}><Icon name="plus" size={16} /> Add</button>
                  </div>
                  <input placeholder="Note, e.g. cash receipt no. (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
                </form>
              )}

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

              <h2 className="cust-sub">History</h2>
              <ul className="ledger">
                {ledger.map((l) => (
                  <li key={l.id} className={l.kind}>
                    <div>
                      <b>{KIND_LABEL[l.kind]}</b>
                      <span>{formatDate(l.createdAt)}{l.by ? ` · ${l.by}` : ''}{l.note ? ` · ${l.note}` : ''}</span>
                    </div>
                    <div className="num">
                      <b>{l.kind === 'purchase' ? '' : '+'}{money(l.amount)}</b>
                      <span>= {money(l.balanceAfter)}</span>
                    </div>
                  </li>
                ))}
                {ledger.length === 0 && <li className="empty-row">No balance changes yet.</li>}
              </ul>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
