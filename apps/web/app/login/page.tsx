'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { FlowPreview } from '@/components/FlowPreview';
import { Icon } from '@/components/Icon';
import { api, ApiError, errorText } from '@/lib/api';

// A plain fetch: the api() helper would bounce a 401 straight back to this page.
const alreadySignedIn = () =>
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false);

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [done, setDone] = useState(false);
  const [shake, setShake] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  // Focus the first field on desktop only; on phones it would pop the keyboard over the page.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) usernameRef.current?.focus();
  }, []);

  // Someone who is still signed in skips this page instead of tripping the security check.
  useEffect(() => {
    alreadySignedIn().then((yes) => yes && window.location.replace('/vend'));
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
      // Signed in meanwhile (another tab, an old session): just go to the desk.
      if (err instanceof ApiError && err.code === 'CSRF' && (await alreadySignedIn())) {
        setDone(true);
        window.location.href = '/vend';
        return;
      }
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
          <FlowPreview />
          <p className="flow-caption"><b>Meter, units, token.</b> Three steps, and the customer is back on power.</p>
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
          <div className="login-head">
            <span className="login-badge" aria-hidden="true"><Icon name="bolt" size={24} /></span>
            <h1>Welcome back</h1>
            <p className="subtitle">Sign in with the details your supervisor gave you.</p>
          </div>
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
