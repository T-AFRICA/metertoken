'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

// Purely illustrative: no request is made and no token is shown, only its masked shape.
const METER = '01234567890';
const UNITS = ['5', '10', '20', '50'];
const TICK_MS = 120;
const LOOP = 86; // ticks per cycle (~10 s)
const AT = { type: 3, verified: 17, units: 25, press: 33, token: 40, fade: 80 };
const FINAL = LOOP - 7; // the resting frame shown when motion is reduced

const groupMeter = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');

export function FlowPreview() {
  const [t, setT] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setT(FINAL);
    const id = setInterval(() => setT((v) => (v + 1) % LOOP), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const typed = METER.slice(0, Math.max(0, Math.min(METER.length, t - AT.type)));
  const typing = t >= AT.type && typed.length < METER.length;
  const verified = t >= AT.verified;
  const unitsChosen = t >= AT.units;
  const pressing = t >= AT.press && t < AT.token;
  const tokenReady = t >= AT.token;
  const step = tokenReady ? 3 : unitsChosen ? 2 : 1;

  return (
    <div className={`flow-demo ${t >= AT.fade ? 'out' : ''}`} aria-hidden="true">
      <div className="fd-head">
        <span className="fd-title"><Icon name="bolt" size={15} /> Generate token</span>
        <span className="fd-tag">Preview</span>
      </div>

      <ol className="fd-steps">
        {['Meter', 'Units', 'Token'].map((label, i) => (
          <li key={label} className={step > i + 1 || (i === 2 && tokenReady) ? 'done' : step === i + 1 ? 'on' : ''}>
            <b>{step > i + 1 || (i === 2 && tokenReady) ? <Icon name="check" size={12} /> : i + 1}</b>
            {label}
          </li>
        ))}
      </ol>

      <div className={`fd-field ${typing ? 'focus' : ''} ${verified ? 'ok' : ''}`}>
        <span className="fd-label">Meter number</span>
        <span className="fd-value">
          {typed ? groupMeter(typed) : <i>11 or 13 digits</i>}
          {typing && <span className="fd-caret" />}
        </span>
        {verified && <span className="fd-ok"><Icon name="check" size={13} /> Verified</span>}
      </div>

      <div className={`fd-units ${verified ? '' : 'dim'}`}>
        <span className="fd-label">Units</span>
        <div className="fd-chips">
          {UNITS.map((u) => (
            <span key={u} className={unitsChosen && u === '20' ? 'sel' : ''}>{u} kWh</span>
          ))}
        </div>
      </div>

      {tokenReady ? (
        <div className="fd-token">
          <span className="fd-label">Token ready · 20 kWh</span>
          <span className="fd-digits">•••• •••• •••• •••• ••••</span>
        </div>
      ) : (
        <div className={`fd-btn ${unitsChosen ? 'ready' : ''} ${pressing ? 'press' : ''}`}>
          {pressing ? <><span className="spinner" /> Generating…</> : <><Icon name="bolt" size={15} /> Generate token</>}
        </div>
      )}
    </div>
  );
}
