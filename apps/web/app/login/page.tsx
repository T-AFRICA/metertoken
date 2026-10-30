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
        <div className="logo" style={{ padding: 0 }}>
          <span className="logo-mark"><Icon name="bolt" size={20} /></span>
          <span className="logo-text">Tronic<small>Token Portal</small></span>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2>Prepaid electricity tokens, issued safely.</h2>
          <p>Verify the meter, enter units, and issue an STS token with a printed receipt — every step recorded.</p>
          <ul className="login-points">
            <li><Icon name="check" /> Server-side pricing from approved tariffs</li>
            <li><Icon name="check" /> Duplicate-vend protection on every meter</li>
            <li><Icon name="check" /> Encrypted tokens and a tamper-evident activity log</li>
          </ul>
        </div>
        <div className="hint" style={{ color: '#7c7c82', position: 'relative', zIndex: 1 }}>© Tronic · Authorised agents only</div>
      </section>

      <section className="login-form-wrap">
        <form className="login-card" onSubmit={submit}>
          <div className="eyebrow">Agent sign in</div>
          <h1>Welcome back</h1>
          <p className="subtitle" style={{ marginBottom: '1.75rem' }}>Sign in with the account your administrator gave you.</p>
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
          <button className="primary huge" disabled={busy} style={{ marginTop: '0.5rem' }}>
            <Icon name="lock" size={17} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="fineprint">All activity is recorded. Do not share your account.</p>
        </form>
      </section>
    </div>
  );
}
