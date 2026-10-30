'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Receipt } from '@/components/Receipt';
import { api, ApiError, errorText } from '@/lib/api';
import { formatToken, isSupervisor, type Quote, type Vend } from '@/lib/types';
import { useSession } from '../session';

type Mode = 'units' | 'amount';
const METER_RE = /^(\d{11}|\d{13})$/;

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
  const quoteSeq = useRef(0);

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
            <div className="eyebrow">Token result</div>
            <h1>{ok ? 'Token generated' : open ? 'Result not confirmed' : 'No token issued'}</h1>
          </div>
          <button onClick={reset}><Icon name="plus" size={16} /> New vend</button>
        </div>
        <div className="grid2">
          <div className="card no-print">
            <div className="result-head">
              <div className={`result-icon ${ok ? 'ok' : open ? 'warn' : 'err'}`}>
                <Icon name={ok ? 'check' : open ? 'alert' : 'x'} size={22} />
              </div>
              <div>
                <span className={`badge ${vend.status}`}>{vend.status}</span>
                <div className="hint">Ref {vend.reference.slice(0, 8).toUpperCase()}</div>
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
                  <dt>Amount</dt><dd>{vend.currency} {vend.amount}</dd>
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

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Vending</div>
          <h1>Generate electricity token</h1>
          <p className="subtitle">Verify the meter, enter units or amount, then generate the token.</p>
        </div>
      </div>
      <div className="grid2">
        <div className="card">
          <div className={`step ${step1}`}>
            <div className="step-n">{step1 === 'done' ? <Icon name="check" size={14} /> : 1}</div>
            <div className="step-body">
              <div className="step-title">Meter number</div>
              <div className="row" style={{ alignItems: 'stretch' }}>
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
                  style={{ flex: 1 }}
                />
                <button onClick={verify} disabled={!meterNo || verifying}>
                  <Icon name="search" size={16} /> {verifying ? 'Checking…' : 'Verify'}
                </button>
              </div>
              {meterError && <div className="alert error"><Icon name="alert" size={16} /> {meterError}</div>}
              {meter?.valid && (
                <div className="alert ok">
                  <Icon name="check" size={16} /> Meter verified{meter.customerName ? ` · ${meter.customerName}` : ''}
                </div>
              )}
            </div>
          </div>

          <div className={`step ${step2}`}>
            <div className="step-n">{step2 === 'done' ? <Icon name="check" size={14} /> : 2}</div>
            <div className="step-body">
              <div className="step-title">How much?</div>
              <div className="segmented" style={{ marginBottom: '0.8rem' }}>
                <button className={mode === 'units' ? 'on' : ''} onClick={() => setMode('units')}>Units (kWh)</button>
                <button className={mode === 'amount' ? 'on' : ''} onClick={() => setMode('amount')}>Amount ({me.currency})</button>
              </div>
              <input
                id="value"
                className="big"
                inputMode="decimal"
                value={value}
                disabled={!meter?.valid}
                aria-label={mode === 'units' ? 'Units in kWh' : `Amount in ${me.currency}`}
                onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder={meter?.valid ? (mode === 'units' ? 'e.g. 5' : 'e.g. 1000') : 'Verify the meter first'}
                style={{ width: '100%' }}
              />
              {quoteError && <div className="alert error"><Icon name="alert" size={16} /> {quoteError}</div>}
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Amount</h2>
          {!quote ? (
            <div className="placeholder-amount">
              <Icon name="receipt" size={36} />
              <div>The price is calculated automatically from the active tariff.</div>
            </div>
          ) : (
            <>
              <div className="amount-hero">
                <div className="cur">{quote.currency}</div>
                <div className="val">{Number(quote.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="sub">{quote.units} kWh · meter <span className="mono">{quote.meterNo}</span></div>
              </div>
              <table className="breakdown">
                <tbody>
                  {quote.lines.map((l) => (
                    <tr key={l.name}><td>{l.name}</td><td className="num">{l.amount}</td></tr>
                  ))}
                  <tr className="total"><td>Total ({quote.currency})</td><td className="num">{quote.amount}</td></tr>
                </tbody>
              </table>
              <p className="hint">Tariff {quote.tariffCode} · price valid until {new Date(quote.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </>
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
              <Icon name="bolt" /> {busy ? 'Generating… do not close' : 'Generate Token'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
