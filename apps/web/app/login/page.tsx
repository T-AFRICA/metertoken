'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, errorText } from '@/lib/api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: { username, password } });
      window.location.href = '/vend';
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="login-split">
      <section className="login-brand">
        <div className="wordmark">
          <Image src="/tronic-logo-white.png" alt="Tronic" width={667} height={148} priority />
          <span>Token desk</span>
        </div>
        <div>
          <h2>
            Keeping the lights on, <em>one token</em> at a time.
          </h2>
          <p>For Tronic agents and cashiers selling prepaid electricity at the counter.</p>
          {/* A quiet nod to the thing on the customer's wall — decorative only. */}
          <div className="meter-face" aria-hidden="true">
            <div className="meter-lcd">
              <div className="r1"><span>CREDIT</span><span>kWh</span></div>
              <div className="r2">0128.40<small>kWh</small></div>
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
      </section>

      <section className="login-form-wrap">
        <form className="login-card" onSubmit={submit}>
          <div className="eyebrow">Welcome back</div>
          <h1>Sign in</h1>
          <p className="subtitle">Use the username and password your supervisor set up for you.</p>
          <div className="field">
            <label htmlFor="username">Username</label>
            <div className="input-icon">
              <Icon name="user" size={18} />
              <input id="username" autoComplete="username" placeholder="Your username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
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
          </div>
          {error && (
            <div className="alert error">
              <Icon name="alert" size={16} /> {error}
            </div>
          )}
          <button className="primary huge login-submit" disabled={busy}>
            {busy ? 'Signing in…' : <>Sign in <Icon name="arrow" size={18} /></>}
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
