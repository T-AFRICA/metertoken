'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, errorText } from '@/lib/api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
          <b>TR<i>O</i>NIC</b>
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
          <h1>Sign in</h1>
          <p className="subtitle">Use the username and password your supervisor set up for you.</p>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && (
            <div className="alert error">
              <Icon name="alert" size={16} /> {error}
            </div>
          )}
          <button className="ink huge" disabled={busy} style={{ marginTop: '0.5rem' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="fineprint">Every sale is logged against your name, so please don’t share your login. Forgot it? Ask your supervisor to reset it.</p>
        </form>
      </section>
    </div>
  );
}
