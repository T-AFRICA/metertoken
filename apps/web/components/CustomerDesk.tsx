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
const STEP_NAME = ['Sign in', 'Units', 'Token'];
const STEP_HINT = ['Sign in with your meter number and the PIN your landlord gave you.', 'Choose how many units you need.', 'Your token is ready — type it on your meter.'];

/**
 * A registered tenant's own token desk: meter number + PIN, then units, then the token.
 * The tenant pays their landlord outside the portal; the server checks everything again.
 */
export function CustomerDesk() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [meterNo, setMeterNo] = useState('');
  const [pin, setPin] = useState('');
  const [units, setUnits] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
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
      call<Quote>('/api/customer/quotes', 'POST', { mode: 'units', value: units })
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
      setVend(r.vend);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE' ? 'You generated the same amount a few minutes ago. Check your recent tokens below, or wait a few minutes.' : errorText(err));
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
  const initials = (c?.name ?? '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="cdesk">
      <div className="cd-head">
        <span className="cd-badge" aria-hidden="true"><Icon name="bolt" size={20} /></span>
        <span className="cd-kicker">Tronic prepaid</span>
        <h3>Token <em>Issuer</em></h3>
        <p key={step}>{STEP_HINT[step - 1]}</p>
        <div className="cd-progress" role="img" aria-label={`Step ${step} of 3: ${STEP_NAME[step - 1]}`}>
          {[1, 2, 3].map((i) => <i key={i} className={i < step ? 'done' : i === step ? 'on' : ''} />)}
        </div>
      </div>

      {checking ? (
        <div className="cd-skeleton" aria-label="Loading"><i /><i /><i /></div>
      ) : !session ? (
        <form onSubmit={signIn} className="cd-form" key="signin">
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
          <p className="cd-note">Not registered yet? Ask your landlord to register your meter and give you a PIN.</p>
        </form>
      ) : !vend ? (
        <div className="cd-form" key="units">
          <div className="cd-who">
            <span className="cd-avatar">{initials}</span>
            <div>
              <b>{c!.name}</b>
              <span>Meter {groupMeter(c!.meterNo)}</span>
            </div>
            <button type="button" className="cd-icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
              <Icon name="logout" size={16} />
            </button>
          </div>

          <label className={`cd-amount ${units ? 'filled' : ''}`} htmlFor="cd-units">
            <input id="cd-units" inputMode="decimal" placeholder="0" autoComplete="off" aria-label="Units in kWh" value={units}
              style={{ width: `${Math.max(1, units.length) * 0.72 + 0.1}em` }}
              onChange={(e) => setUnits(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} />
            <span>kWh</span>
          </label>
          <div className="fd-chips">
            {QUICK_UNITS.map((u) => (
              <button type="button" key={u} className={units === u ? 'sel' : ''} onClick={() => setUnits(u)}>{u}</button>
            ))}
          </div>

          <div className="cd-price" aria-live="polite">
            {quote ? (
              <>
                <span>Price · incl. VAT</span>
                <b key={quote.quoteId}>{quote.currency} {money(quote.amount)}</b>
              </>
            ) : (
              <span className={quoteError ? 'err' : ''}>{quoteError || (units ? 'Working out the price…' : 'Prices include VAT and levies')}</span>
            )}
          </div>

          {error && <div className="cd-error"><Icon name="alert" size={14} /> {error}</div>}
          <button className="primary cd-btn" onClick={generate} disabled={busy || !quote}>
            {busy ? <><span className="spinner" /> Generating…</> : <><Icon name="bolt" size={16} /> Generate token</>}
          </button>

          {recent.length > 0 && (
            <div className="cd-recent">
              <span className="fd-label">Recent tokens</span>
              {recent.slice(0, 2).map((r) => (
                <button type="button" key={r.id} onClick={() => showRecent(r.id)} disabled={r.status !== 'SUCCEEDED'}>
                  <i><Icon name="bolt" size={13} /></i>
                  <span>
                    <b>{money(r.units)} kWh</b>
                    <small>{new Date(r.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                  </span>
                  <em className="mono">{r.status === 'SUCCEEDED' ? `•••• ${r.tokenLast4}` : r.status === 'FAILED' ? 'Not issued' : 'Checking'}</em>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="cd-form" key="token">
          {vend.status === 'SUCCEEDED' && vend.tokens ? (
            <>
              <div className="fd-token cd-token">
                <div className="cd-token-top">
                  <span>{money(vend.units)} kWh</span>
                  <span>Meter {groupMeter(vend.meterNo)}</span>
                </div>
                {vend.tokens.map((t) => <span key={t} className="fd-digits">{formatToken(t)}</span>)}
                <small>{vend.currency} {money(vend.amount)} · Ref {vend.reference.slice(0, 8).toUpperCase()}</small>
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
            </>
          ) : vend.status === 'FAILED' ? (
            <div className="cd-state">
              <Icon name="alert" size={22} />
              <b>No token was issued</b>
              <span>The vendor turned this request down. Nothing was charged; you can try again.</span>
            </div>
          ) : (
            <div className="cd-state">
              <Icon name="history" size={22} />
              <b>We’re confirming your token</b>
              <span>The vendor did not answer in time. Your landlord or Tronic will check it — please don’t generate another token for this meter yet. Reference {vend.reference.slice(0, 8).toUpperCase()}.</span>
            </div>
          )}
          <button type="button" className="cd-link" onClick={another}><Icon name="back" size={14} /> Generate another token</button>
        </div>
      )}
    </div>
  );
}
