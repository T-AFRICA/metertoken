'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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
  const [mode, setMode] = useState<Mode>('units');
  const [value, setValue] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [idemKey, setIdemKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [vend, setVend] = useState<Vend | null>(null);
  const [vendError, setVendError] = useState<ApiError | null>(null);
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
  }

  async function verify() {
    setMeterError('');
    setMeter(null);
    setQuote(null);
    if (!METER_RE.test(meterNo)) {
      setMeterError('Meter number must be 11 or 13 digits');
      return;
    }
    try {
      setMeter(await api('/api/meters/verify', { method: 'POST', body: { meterNo } }));
    } catch (e) {
      setMeterError(errorText(e));
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

  if (vend) {
    return (
      <div className="grid2">
        <div className="card no-print">
          <h1>
            Result <span className={`badge ${vend.status}`}>{vend.status}</span>
          </h1>
          {vend.status === 'SUCCEEDED' && (
            <>
              <p>Meter <b className="mono">{vend.meterNo}</b> · {vend.units} kWh · {vend.currency} {vend.amount}</p>
              {(vend.tokens ?? []).map((t, i) => (
                <div key={i} className={`token-box ${vend.adapterMode === 'mock' ? 'mock' : ''}`}>{formatToken(t)}</div>
              ))}
              <div className="row">
                <button className="primary" onClick={print}>Print receipt</button>
                <button onClick={() => navigator.clipboard.writeText((vend.tokens ?? []).join('\n'))}>Copy token</button>
                <button onClick={reset}>New vend</button>
              </div>
            </>
          )}
          {(vend.status === 'UNKNOWN' || vend.status === 'MANUAL_REVIEW') && (
            <div className="alert warn">
              <b>Result not confirmed.</b> {vend.errorMessage}
              <br />
              Do <b>not</b> generate another token for this meter. A supervisor must check the vendor records and resolve it in{' '}
              <Link href={`/vends/${vend.id}`}>this transaction</Link>.
            </div>
          )}
          {vend.status === 'FAILED' && (
            <div className="alert error">
              <b>No token was issued.</b> {vend.errorMessage}
            </div>
          )}
          {vend.status !== 'SUCCEEDED' && <button onClick={reset}>New vend</button>}
        </div>
        {vend.status === 'SUCCEEDED' && (
          <div className="card">
            <Receipt vend={vend} />
          </div>
        )}
      </div>
    );
  }

  const dup = vendError?.code === 'POSSIBLE_DUPLICATE';
  return (
    <>
      <h1>Generate electricity token</h1>
      <div className="grid2">
        <div className="card">
          <div className="field">
            <label htmlFor="meter">1. Meter number</label>
            <div className="row">
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
                style={{ flex: 1 }}
              />
              <button onClick={verify} disabled={!meterNo}>Verify</button>
            </div>
            {meterError && <div className="alert error">{meterError}</div>}
            {meter?.valid && (
              <div className="alert ok">
                Meter verified{meter.customerName ? ` · ${meter.customerName}` : ''}
              </div>
            )}
          </div>

          <div className="field">
            <label>2. Buy by</label>
            <div className="segmented">
              <button className={mode === 'units' ? 'on' : ''} onClick={() => setMode('units')}>Units (kWh)</button>
              <button className={mode === 'amount' ? 'on' : ''} onClick={() => setMode('amount')}>Amount ({me.currency})</button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="value">{mode === 'units' ? '3. Units (kWh)' : `3. Amount (${me.currency})`}</label>
            <input
              id="value"
              className="big"
              inputMode="decimal"
              value={value}
              disabled={!meter?.valid}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={meter?.valid ? (mode === 'units' ? 'e.g. 5' : 'e.g. 1000') : 'Verify the meter first'}
            />
            {quoteError && <div className="alert error">{quoteError}</div>}
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>4. Amount</h2>
          {!quote && <p className="hint">The amount is calculated automatically from the active tariff.</p>}
          {quote && (
            <>
              <table className="breakdown">
                <tbody>
                  <tr><td>Units</td><td className="num">{quote.units} kWh</td></tr>
                  {quote.lines.map((l) => (
                    <tr key={l.name}><td>{l.name}</td><td className="num">{l.amount}</td></tr>
                  ))}
                  <tr className="total"><td>Total ({quote.currency})</td><td className="num">{quote.amount}</td></tr>
                </tbody>
              </table>
              <p className="hint">Tariff {quote.tariffCode}. Price valid until {new Date(quote.expiresAt).toLocaleTimeString()}.</p>
            </>
          )}
          {vendError && (
            <div className={`alert ${dup ? 'warn' : 'error'}`}>
              {vendError.message}
              {dup && !isSupervisor(me.user.role) && <> Ask a supervisor to confirm this vend.</>}
            </div>
          )}
          {dup && isSupervisor(me.user.role) ? (
            <button className="danger huge" disabled={busy} onClick={() => generate(true)}>
              Confirm — vend again
            </button>
          ) : (
            <button className="primary huge" disabled={!quote || busy} onClick={() => generate(false)}>
              {busy ? 'Generating… do not close' : 'Generate Token'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
