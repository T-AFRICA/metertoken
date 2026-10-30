'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, errorText } from '@/lib/api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [done, setDone] = useState(false);
  const [shake, setShake] = useState(false);
  const [lcd, setLcd] = useState(0);
  const usernameRef = useRef<HTMLInputElement>(null);

  // Focus the first field on desktop only; on phones it would pop the keyboard over the page.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) usernameRef.current?.focus();
  }, []);

  // The decorative meter counts its credit up once, as if a token had just loaded.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setLcd(128.4);
    let frame = 0;
    const start = performance.now() + 700;
    const tick = (now: number) => {
      const t = Math.min(Math.max((now - start) / 1600, 0), 1);
      setLcd(128.4 * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: { username, password } });
      setDone(true);
      window.location.href = '/vend';
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      // Restart the shake even when the same error repeats.
      setShake(false);
      requestAnimationFrame(() => setShake(true));
    }
  }

  return (
    <div className="login-split">
      <section className="login-brand">
        <div className="wordmark">
          <Image src="/tronic-logo-white.png" alt="Tronic" width={667} height={148} priority />
          <span>Token desk</span>
        </div>
        <div className="login-pitch">
          <h2>
            Keeping the lights on, <em>one token</em> at a time.
          </h2>
          <p>For Tronic agents and cashiers selling prepaid electricity at the counter.</p>
          {/* A quiet nod to the thing on the customer's wall — decorative only. */}
          <div className="meter-face" aria-hidden="true">
            <div className="meter-lcd">
              <div className="r1"><span>CREDIT</span><span>kWh</span></div>
              <div className="r2">{lcd.toFixed(2).padStart(7, '0')}<small>kWh</small></div>
            </div>
            <div className="meter-keys">
              {Array.from({ length: 12 }, (_, i) => <span key={i} className={i === 11 ? 'on' : ''} />)}
            </div>
          </div>
        </div>
        <div className="login-foot">
          <span>Tronic Kenya · Nairobi</span>
          <span>Agents only</span>
        </div>
        {/* Rings that radiate out from the sun, like the one in the logo. */}
        <div className="radiate" aria-hidden="true"><i /><i /><i /></div>
      </section>

      <section className="login-form-wrap">
        <form className={`login-card ${shake ? 'shake' : ''}`} onSubmit={submit} onAnimationEnd={(e) => e.animationName === 'shake' && setShake(false)}>
          <div className="eyebrow">Welcome back</div>
          <h1>Sign in</h1>
          <p className="subtitle">Use the username and password your supervisor set up for you.</p>
          <div className="field">
            <label htmlFor="username">Username</label>
            <div className="input-icon">
              <Icon name="user" size={18} />
              <input ref={usernameRef} id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Your username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input-icon">
              <Icon name="lock" size={18} />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                onBlur={() => setCapsLock(false)}
                required
              />
              <button
                type="button"
                className="reveal"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </div>
            {capsLock && <div className="caps-hint"><Icon name="alert" size={14} /> Caps Lock is on</div>}
          </div>
          {error && (
            <div className="alert error">
              <Icon name="alert" size={16} /> {error}
            </div>
          )}
          <button className={`primary huge login-submit ${done ? 'done' : ''}`} disabled={busy}>
            {done ? <><Icon name="check" size={18} /> Signed in</> : busy ? <><span className="spinner" aria-hidden /> Signing in…</> : <>Sign in <Icon name="arrow" size={18} /></>}
          </button>
          <p className="fineprint">
            <Icon name="shield" size={16} />
            <span>Every sale is logged against your name, so please don’t share your login. Forgot it? Ask your supervisor to reset it.</span>
          </p>
          <div className="login-mobile-foot">Tronic Kenya · Nairobi · Agents only</div>
        </form>
      </section>
    </div>
  );
}
