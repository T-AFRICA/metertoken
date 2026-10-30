'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SkeletonRows } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { Receipt } from '@/components/Receipt';
import { Stat, type Bar } from '@/components/Stat';
import { api, ApiError, errorText } from '@/lib/api';
import { formatToken, isSupervisor, statusLabel, type Quote, type Vend, type VendStatus } from '@/lib/types';
import { useSession } from '../session';

type Mode = 'units' | 'amount';
const METER_RE = /^(\d{11}|\d{13})$/;

interface RecentVend {
  id: string;
  meterNo: string;
  units: string;
  amount: string;
  currency: string;
  status: VendStatus;
  createdAt: string;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function VendPage() {
  const me = useSession();
  const [meterNo, setMeterNo] = useState('');
  const [meter, setMeter] = useState<{ valid: boolean; customerName?: string } | null>(null);
  const [meterError, setMeterError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [mode, setMode] = useState<Mode>('units');
  const [value, setValue] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [idemKey, setIdemKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [vend, setVend] = useState<Vend | null>(null);
  const [vendError, setVendError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);
  const [requote, setRequote] = useState(0);
  const [recent, setRecent] = useState<RecentVend[] | null>(null);
  const quoteSeq = useRef(0);
  const router = useRouter();

  // Today's sales for the strip and table; refreshed when returning from a result.
  useEffect(() => {
    if (vend) return;
    api<{ items: RecentVend[] }>(`/api/vends?from=${todayIso()}&limit=200`)
      .then((r) => setRecent(r.items))
      .catch(() => setRecent([]));
  }, [vend]);

  function reset() {
    setMeterNo('');
    setMeter(null);
    setMeterError('');
    setValue('');
    setQuote(null);
    setQuoteError('');
    setVend(null);
    setVendError(null);
    setCopied(false);
  }

  async function verify() {
    setMeterError('');
    setMeter(null);
    setQuote(null);
    if (!METER_RE.test(meterNo)) {
      setMeterError('Meter number must be 11 or 13 digits');
      return;
    }
    setVerifying(true);
    try {
      setMeter(await api('/api/meters/verify', { method: 'POST', body: { meterNo } }));
    } catch (e) {
      setMeterError(errorText(e));
    } finally {
      setVerifying(false);
    }
  }

  // Automatic amount: re-quote shortly after the operator stops typing.
  useEffect(() => {
    setQuote(null);
    setQuoteError('');
    if (!meter?.valid || !/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) return;
    const seq = ++quoteSeq.current;
    const t = setTimeout(async () => {
      try {
        const q = await api<Quote>('/api/quotes', { method: 'POST', body: { meterNo, mode, value } });
        if (seq !== quoteSeq.current) return;
        setQuote(q);
        setIdemKey(crypto.randomUUID());
      } catch (e) {
        if (seq === quoteSeq.current) setQuoteError(errorText(e));
      }
    }, 450);
    return () => clearTimeout(t);
  }, [meter, meterNo, mode, value, requote]);

  async function generate(confirmDuplicate = false) {
    if (!quote) return;
    setBusy(true);
    setVendError(null);
    try {
      const v = await api<Vend>('/api/vends', {
        method: 'POST',
        body: { quoteId: quote.quoteId, confirmDuplicate },
        headers: { 'idempotency-key': idemKey },
      });
      setVend(v);
    } catch (e) {
      setVendError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', errorText(e), {}));
      // Expired/used quotes need a fresh quote and key.
      if (e instanceof ApiError && ['QUOTE_EXPIRED', 'QUOTE_USED'].includes(e.code)) setRequote((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    if (!vend) return;
    await api(`/api/vends/${vend.id}/print`, { method: 'POST', body: { reprint: false } }).catch(() => undefined);
    window.print();
  }

  async function copy() {
    if (!vend?.tokens) return;
    await navigator.clipboard.writeText(vend.tokens.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (vend) {
    const ok = vend.status === 'SUCCEEDED';
    const open = vend.status === 'UNKNOWN' || vend.status === 'MANUAL_REVIEW';
    return (
      <>
        <div className="page-head no-print">
          <div>
            <div className="eyebrow">Ref {vend.reference.slice(0, 8).toUpperCase()}</div>
            <h1>{ok ? 'Here’s the token.' : open ? 'We’re not sure yet.' : 'No token was issued.'}</h1>
          </div>
          <button onClick={reset}><Icon name="plus" size={16} /> Next customer</button>
        </div>
        <div className="grid2">
          <div className="card no-print">
            <div className="result-head">
              <div className={`result-icon ${ok ? 'ok' : open ? 'warn' : 'err'}`}>
                <Icon name={ok ? 'check' : open ? 'alert' : 'x'} size={22} />
              </div>
              <div>
                <b>{ok ? 'Read these digits to the customer, or print the receipt.' : open ? 'The vendor didn’t give a clear answer.' : 'Nothing was charged to the meter.'}</b>
                <div className="hint"><span className={`badge ${vend.status}`}>{statusLabel(vend.status)}</span></div>
              </div>
            </div>

            {ok && (
              <>
                {(vend.tokens ?? []).map((t, i, all) => (
                  <div key={i} className={`token-box ${vend.adapterMode === 'mock' ? 'mock' : ''}`}>
                    <span className="tl">{all.length > 1 && i < all.length - 1 ? `Key change token ${i + 1} — enter first` : vend.adapterMode === 'mock' ? 'Mock token · not valid' : 'STS credit token'}</span>
                    {formatToken(t)}
                  </div>
                ))}
                <dl className="kv">
                  <dt>Meter</dt><dd className="mono">{vend.meterNo}</dd>
                  <dt>Units</dt><dd>{vend.units} kWh</dd>
                  <dt>Amount</dt><dd>{vend.currency} {Number(vend.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                </dl>
                <div className="row" style={{ marginTop: '1.25rem' }}>
                  <button className="primary" onClick={print}><Icon name="printer" size={16} /> Print receipt</button>
                  <button onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy token'}</button>
                </div>
              </>
            )}
            {open && (
              <div className="alert warn">
                <Icon name="alert" size={16} />
                <div>
                  <b>Do not generate another token for this meter.</b> {vend.errorMessage}
                  <br />A supervisor must check the vendor records and resolve <Link href={`/vends/${vend.id}`}>this transaction</Link>.
                </div>
              </div>
            )}
            {vend.status === 'FAILED' && (
              <div className="alert error">
                <Icon name="x" size={16} />
                <div><b>No token was issued.</b> {vend.errorMessage}</div>
              </div>
            )}
          </div>
          {ok && (
            <div className="receipt-stage">
              <Receipt vend={vend} />
            </div>
          )}
        </div>
      </>
    );
  }

  const dup = vendError?.code === 'POSSIBLE_DUPLICATE';
  const step1 = meter?.valid ? 'done' : 'current';
  const step2 = !meter?.valid ? '' : quote ? 'done' : 'current';
  const quick = mode === 'units' ? ['5', '10', '20', '50'] : ['1000', '2000', '5000', '10000'];
  const sold = (recent ?? []).filter((r) => r.status === 'SUCCEEDED');
  const attention = (recent ?? []).filter((r) => r.status === 'UNKNOWN' || r.status === 'MANUAL_REVIEW').length;
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kwh = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const salesTotal = sold.reduce((s, r) => s + Number(r.amount), 0);
  const unitsTotal = sold.reduce((s, r) => s + Number(r.units), 0);
  const last = sold.reduce<RecentVend | undefined>((a, r) => (!a || r.createdAt > a.createdAt ? r : a), undefined);
  // The last ten hours of today's sales, one bar per hour, ending with the current hour.
  const byHour = (measure: (r: RecentVend) => number, tip: (hour: string, n: number) => string): Bar[] => {
    const now = new Date().getHours();
    return Array.from({ length: Math.min(10, now + 1) }, (_, i) => {
      const h = now - (Math.min(10, now + 1) - 1) + i;
      const n = sold.filter((r) => new Date(r.createdAt).getHours() === h).reduce((s, r) => s + measure(r), 0);
      const hour = `${String(h).padStart(2, '0')}:00`;
      return { label: hour, value: n, tip: tip(hour, n) };
    });
  };
  const own = me.user.role === 'cashier';

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{greeting()}, {me.user.displayName.split(/\s+/)[0]}</div>
          <h1>Generate token</h1>
          <p className="subtitle">Verify the meter, choose units or an amount, then issue the token.</p>
        </div>
        <Link className="button" href="/history"><Icon name="history" size={16} /> All transactions</Link>
      </div>

      <div className="grid4">
        <Stat
          icon="bolt"
          label={`${own ? 'Your tokens' : 'Tokens'} today`}
          value={recent ? sold.length : '–'}
          trend={recent ? byHour(() => 1,(h, n) => `${h} · ${n} token${n === 1 ? '' : 's'}`) : undefined}
          note={last ? `Last at ${clock(last.createdAt)}` : recent && 'None yet today'}
        />
        <Stat
          icon="chart"
          label={`${own ? 'Your sales' : 'Sales'} today`}
          prefix={me.currency}
          value={recent ? money(salesTotal) : '–'}
          trend={recent ? byHour((r) => Number(r.amount), (h, n) => `${h} · ${me.currency} ${money(n)}`) : undefined}
          note={sold.length ? `Avg ${me.currency} ${money(salesTotal / sold.length)} per token` : recent && 'No sales yet'}
        />
        <Stat
          icon="meter"
          label="Units sold"
          suffix="kWh"
          value={recent ? kwh(unitsTotal) : '–'}
          trend={recent ? byHour((r) => Number(r.units), (h, n) => `${h} · ${kwh(n)} kWh`) : undefined}
          note={sold.length ? `Avg ${kwh(unitsTotal / sold.length)} kWh per token` : recent && 'No units yet'}
        />
        <Stat
          icon={attention ? 'alert' : 'check'}
          label="Need attention"
          tone={attention ? 'warn' : 'ok'}
          value={recent ? attention : '–'}
          note={recent && (attention ? <Link href="/history">Resolve in Transactions →</Link> : 'All clear — nothing pending')}
        />
      </div>

      <div className="vend-layout">
        <div>
          <div className="card">
            <div className={`step ${step1}`}>
              <div className="step-n">{step1 === 'done' ? <Icon name="check" size={14} /> : '1'}</div>
              <div className="step-body">
                <div className="step-title">Meter number</div>
                <div className="input-group">
                  <input
                    id="meter"
                    className="big"
                    inputMode="numeric"
                    maxLength={13}
                    value={meterNo}
                    onChange={(e) => {
                      setMeterNo(e.target.value.replace(/\D/g, ''));
                      setMeter(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && verify()}
                    placeholder="11 or 13 digits"
                    aria-label="Meter number"
                  />
                  <button className="ink" onClick={verify} disabled={verifying}>
                    <Icon name="search" size={16} /> {verifying ? 'Checking…' : 'Verify'}
                  </button>
                </div>
                {meterError && <div className="alert error"><Icon name="alert" size={16} /> {meterError}</div>}
                {meter?.valid && (
                  <div className="alert ok">
                    <Icon name="check" size={16} /> {meter.customerName ? <>Meter verified · <b>{meter.customerName}</b></> : 'Meter verified'}
                  </div>
                )}
              </div>
            </div>

            <div className={`step ${step2}`}>
              <div className="step-n">{step2 === 'done' ? <Icon name="check" size={14} /> : '2'}</div>
              <div className="step-body">
                <div className="step-head">
                  <div className="step-title">Quantity</div>
                  <div className="segmented">
                    <button className={mode === 'units' ? 'on' : ''} onClick={() => setMode('units')}>Units (kWh)</button>
                    <button className={mode === 'amount' ? 'on' : ''} onClick={() => setMode('amount')}>Amount ({me.currency})</button>
                  </div>
                </div>
                <div className="input-affix">
                  <input
                    id="value"
                    className="big"
                    inputMode="decimal"
                    value={value}
                    disabled={!meter?.valid}
                    aria-label={mode === 'units' ? 'Units in kWh' : `Amount in ${me.currency}`}
                    onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder={meter?.valid ? '0' : 'Verify the meter first'}
                  />
                  <span>{mode === 'units' ? 'kWh' : me.currency}</span>
                </div>
                <div className="quick">
                  {quick.map((q) => (
                    <button key={q} className={value === q ? 'on' : ''} disabled={!meter?.valid} onClick={() => setValue(q)}>
                      {Number(q).toLocaleString()}{mode === 'units' ? ' kWh' : ''}
                    </button>
                  ))}
                </div>
                {quoteError && <div className="alert error"><Icon name="alert" size={16} /> {quoteError}</div>}
              </div>
            </div>
          </div>

          <div className="card flush">
            <div className="card-head">
              <h2>{me.user.role === 'cashier' ? 'Your sales today' : 'Sales today'}</h2>
              <Link href="/history" className="link-quiet">View all</Link>
            </div>
            <div className="table-wrap">
              <table className="stack">
                <thead>
                  <tr><th>Time</th><th>Meter</th><th className="num">kWh</th><th className="num">Amount</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {!recent && <SkeletonRows cols={5} rows={3} />}
                  {(recent ?? []).slice(0, 6).map((r) => (
                    <tr key={r.id} className="click" onClick={() => router.push(`/vends/${r.id}`)}>
                      <td className="nowrap muted" data-label="Time">{new Date(r.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="mono" data-label="Meter">{r.meterNo}</td>
                      <td className="num" data-label="kWh">{r.units}</td>
                      <td className="num" data-label="Amount">{r.currency} {money(Number(r.amount))}</td>
                      <td data-label="Status"><span className={`badge ${r.status}`}>{statusLabel(r.status)}</span></td>
                    </tr>
                  ))}
                  {recent && recent.length === 0 && (
                    <tr><td colSpan={5} className="empty">No sales yet today. The first token you generate shows up here.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside className="card summary">
          <div className="summary-head">
            <h2>Summary</h2>
            {quote && <span className="tag">Tariff {quote.tariffCode}</span>}
          </div>
          <div className="amount-hero">
            <div className="cur">Total to pay · {quote?.currency ?? me.currency}</div>
            {quote ? (
              <div className="val" key={quote.amount}>{money(Number(quote.amount))}</div>
            ) : (
              <div className="val zero">0.00</div>
            )}
          </div>
          <dl className="kv summary-kv">
            <dt>Meter</dt><dd className="mono">{meter?.valid ? meterNo : '—'}</dd>
            <dt>Customer</dt><dd>{meter?.valid ? meter.customerName ?? '—' : '—'}</dd>
            <dt>Units</dt><dd>{quote ? `${quote.units} kWh` : '—'}</dd>
          </dl>
          {quote && (
            <table className="breakdown">
              <tbody>
                {quote.lines.map((l) => (
                  <tr key={l.name}><td>{l.name}</td><td className="num">{l.amount}</td></tr>
                ))}
                <tr className="total"><td>Total</td><td className="num">{quote.amount}</td></tr>
              </tbody>
            </table>
          )}
          {vendError && (
            <div className={`alert ${dup ? 'warn' : 'error'}`}>
              <Icon name="alert" size={16} />
              <div>
                {vendError.message}
                {dup && !isSupervisor(me.user.role) && <> Ask a supervisor to confirm this vend.</>}
              </div>
            </div>
          )}
          {dup && isSupervisor(me.user.role) ? (
            <button className="danger huge" disabled={busy} onClick={() => generate(true)}>
              Confirm — vend again
            </button>
          ) : (
            <button className="primary huge" disabled={!quote || busy} onClick={() => generate(false)}>
              <Icon name="bolt" size={17} /> {busy ? 'Generating — keep this page open…' : 'Generate token'}
            </button>
          )}
          <p className="summary-note">
            <Icon name="lock" size={14} />
            <span>
              {quote
                ? `Price locked until ${new Date(quote.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Tokens can’t be refunded once issued.`
                : 'The price comes from the approved tariff. Tokens can’t be refunded once issued.'}
            </span>
          </p>
        </aside>
      </div>
    </>
  );
}
