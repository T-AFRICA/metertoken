'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { api, ApiError, errorText } from '@/lib/api';
import { downloadTokenReceipt } from '@/lib/receipt-image';
import { formatToken, groupMeter, money, type Customer, type Quote, type Vend, type VendStatus } from '@/lib/types';

interface Session {
  customer: Customer;
  csrfToken: string;
  adapterMode: 'mock' | 'live';
}

interface CustomerQuote extends Quote {
  balance: string;
  affordable: boolean;
}

interface Recent {
  id: string;
  units: string;
  amount: string;
  currency: string;
  status: VendStatus;
  tokenLast4: string | null;
  createdAt: string;
}

const QUICK_UNITS = ['5', '10', '20', '50'];
const METER_RE = /^(\d{11}|\d{13})$/;

/**
 * A registered customer's own token desk: meter number + PIN, then units, then the token.
 * Paid from the balance a Tronic counter topped up; the server checks everything again.
 */
export function CustomerDesk() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [meterNo, setMeterNo] = useState('');
  const [pin, setPin] = useState('');
  const [units, setUnits] = useState('');
  const [quote, setQuote] = useState<CustomerQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [vend, setVend] = useState<Vend | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [requote, setRequote] = useState(0);
  const idemKey = useRef('');
  const quoteSeq = useRef(0);
  // A password field makes browsers treat this card as a staff login and fill in saved staff details.
  // Where the browser can mask a plain text field, the PIN uses one; otherwise a "new password" field, which is never autofilled.
  const [pinProps, setPinProps] = useState<{ type: string; autoComplete: string; className?: string }>({ type: 'password', autoComplete: 'new-password' });
  useEffect(() => {
    if (CSS.supports('-webkit-text-security', 'disc')) setPinProps({ type: 'text', autoComplete: 'off', className: 'pin-mask' });
  }, []);

  const call = <T,>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    api<T>(path, { method, body, headers: { ...(session ? { 'x-csrf-token': session.csrfToken } : {}), ...headers } });

  useEffect(() => {
    api<Session>('/api/customer/me')
      .then(setSession)
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!session || vend) return;
    call<{ items: Recent[] }>('/api/customer/vends').then((r) => setRecent(r.items)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, vend]);

  // A fresh server quote (and request key) for every units change, a moment after typing stops.
  useEffect(() => {
    setQuote(null);
    setQuoteError('');
    if (!session || vend || !units || Number(units) <= 0) return;
    const seq = ++quoteSeq.current;
    const t = setTimeout(() => {
      call<CustomerQuote>('/api/customer/quotes', 'POST', { mode: 'units', value: units })
        .then((q) => {
          if (seq !== quoteSeq.current) return;
          idemKey.current = crypto.randomUUID();
          setQuote(q);
        })
        .catch((e) => seq === quoteSeq.current && setQuoteError(errorText(e)));
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, session, vend, requote]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setSession(await api<Session>('/api/customer/login', { method: 'POST', body: { meterNo, pin } }));
      setPin('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await call('/api/customer/logout', 'POST').catch(() => undefined);
    setSession(null);
    setVend(null);
    setUnits('');
    setRecent([]);
  }

  async function generate() {
    if (!quote || !session) return;
    setError('');
    setBusy(true);
    try {
      const r = await call<{ vend: Vend; customer: Customer }>('/api/customer/vends', 'POST', { quoteId: quote.quoteId }, { 'idempotency-key': idemKey.current });
      setSession({ ...session, customer: r.customer });
      setVend(r.vend);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE' ? 'You bought the same amount a few minutes ago. Check your recent tokens below, or wait a few minutes.' : errorText(err));
      // The quote may be spent or expired; fetch a new one.
      setRequote((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function showRecent(id: string) {
    setError('');
    try {
      setVend(await call<Vend>(`/api/customer/vends/${id}`));
    } catch (err) {
      setError(errorText(err));
    }
  }

  function another() {
    setVend(null);
    setUnits('');
    setCopied(false);
  }

  async function copy() {
    if (!vend?.tokens) return;
    await navigator.clipboard.writeText(vend.tokens.map(formatToken).join('\n')).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const step = !session ? 1 : vend ? 3 : 2;
  const c = session?.customer;
  const short = Boolean(quote && !quote.affordable);

  return (
    <div className="cdesk">
      <div className="fd-head">
        <span className="fd-title"><Icon name="bolt" size={15} /> Buy a token</span>
        <span className="fd-tag">Customers</span>
      </div>

      <ol className="fd-steps">
        {['Sign in', 'Units', 'Token'].map((label, i) => (
          <li key={label} className={step > i + 1 ? 'done' : step === i + 1 ? 'on' : ''}>
            <b>{step > i + 1 ? <Icon name="check" size={12} /> : i + 1}</b>
            {label}
          </li>
        ))}
      </ol>

      {checking ? (
        <p className="cd-muted">Loading…</p>
      ) : !session ? (
        <form onSubmit={signIn} className="cd-form">
          <label className="fd-label" htmlFor="cd-meter">Meter number</label>
          <div className="input-icon">
            <Icon name="meter" size={18} />
            <input id="cd-meter" name="tronic-meter" inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="11 or 13 digits" maxLength={13}
              value={meterNo} onChange={(e) => setMeterNo(e.target.value.replace(/\D/g, ''))} required />
          </div>
          <label className="fd-label" htmlFor="cd-pin">PIN</label>
          <div className="input-icon">
            <Icon name="lock" size={18} />
            <input id="cd-pin" name="tronic-pin" {...pinProps} inputMode="numeric" data-1p-ignore data-lpignore="true" placeholder="4–6 digits" maxLength={6}
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
          </div>
          {error && <div className="cd-error"><Icon name="alert" size={14} /> {error}</div>}
          <button className="primary cd-btn" disabled={busy || !METER_RE.test(meterNo) || pin.length < 4}>
            {busy ? <><span className="spinner" /> Checking…</> : <>Continue <Icon name="arrow" size={16} /></>}
          </button>
          <p className="cd-note">Not registered yet? Visit a Tronic counter with your meter number to get a PIN and top up.</p>
        </form>
      ) : !vend ? (
        <div className="cd-form">
          <div className="cd-who">
            <div>
              <b>{c!.name}</b>
              <span>Meter {groupMeter(c!.meterNo)}</span>
            </div>
            <div className="cd-balance">
              <span>Balance</span>
              <b>{c!.currency} {money(c!.balance)}</b>
            </div>
          </div>

          <label className="fd-label" htmlFor="cd-units">How many units?</label>
          <div className="input-affix cd-units">
            <input id="cd-units" inputMode="decimal" placeholder="e.g. 20" value={units}
              onChange={(e) => setUnits(e.target.value.replace(/[^\d.]/g, ''))} />
            <span>kWh</span>
          </div>
          <div className="fd-chips">
            {QUICK_UNITS.map((u) => (
              <button type="button" key={u} className={units === u ? 'sel' : ''} onClick={() => setUnits(u)}>{u} kWh</button>
            ))}
          </div>

          <div className={`cd-total ${short ? 'short' : ''}`}>
            {quote ? (
              <>
                <span>Total</span>
                <b>{quote.currency} {money(quote.amount)}</b>
                <em>{short ? 'Your balance is too low — top up at a Tronic counter' : `Balance after: ${quote.currency} ${money(Number(c!.balance) - Number(quote.amount))}`}</em>
              </>
            ) : (
              <span className="cd-muted">{quoteError || (units ? 'Working out the price…' : 'Pick or type the units you want')}</span>
            )}
          </div>

          {error && <div className="cd-error"><Icon name="alert" size={14} /> {error}</div>}
          <button className="primary cd-btn" onClick={generate} disabled={busy || !quote || short}>
            {busy ? <><span className="spinner" /> Generating…</> : <><Icon name="bolt" size={16} /> Generate token</>}
          </button>

          {recent.length > 0 && (
            <div className="cd-recent">
              <span className="fd-label">Recent tokens</span>
              {recent.slice(0, 3).map((r) => (
                <button type="button" key={r.id} onClick={() => showRecent(r.id)} disabled={r.status !== 'SUCCEEDED'}>
                  <span>{new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {r.units} kWh</span>
                  <span className="mono">{r.status === 'SUCCEEDED' ? `•••• ${r.tokenLast4}` : r.status === 'FAILED' ? 'Refunded' : 'Being checked'}</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" className="cd-link" onClick={signOut}>Sign out</button>
        </div>
      ) : (
        <div className="cd-form">
          {vend.status === 'SUCCEEDED' && vend.tokens ? (
            <>
              <div className="fd-token cd-token">
                <span className="fd-label">Your token · {vend.units} kWh</span>
                {vend.tokens.map((t) => <span key={t} className="fd-digits">{formatToken(t)}</span>)}
              </div>
              {vend.adapterMode === 'mock' && <p className="cd-test"><Icon name="alert" size={13} /> Test token — practice only, it will not load on a real meter.</p>}
              <div className="cd-actions">
                <button type="button" className="primary cd-btn" onClick={() => downloadTokenReceipt(vend, c!.name)}>
                  <Icon name="download" size={16} /> Download
                </button>
                <button type="button" className="cd-btn ghost" onClick={copy}>
                  <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="cd-note">Paid {vend.currency} {money(vend.amount)} · balance now {c!.currency} {money(c!.balance)}</p>
            </>
          ) : vend.status === 'FAILED' ? (
            <div className="cd-state">
              <Icon name="alert" size={22} />
              <b>No token was issued</b>
              <span>The vendor turned this request down. Your balance was refunded.</span>
            </div>
          ) : (
            <div className="cd-state">
              <Icon name="history" size={22} />
              <b>We’re confirming your token</b>
              <span>The vendor did not answer in time. Your money is held, not lost. Staff will check it — please don’t buy again for this meter yet. Reference {vend.reference.slice(0, 8).toUpperCase()}.</span>
            </div>
          )}
          <button type="button" className="cd-link" onClick={another}>← Buy another token</button>
        </div>
      )}
    </div>
  );
}
