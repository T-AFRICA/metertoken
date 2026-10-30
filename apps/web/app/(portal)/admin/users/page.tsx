'use client';

import { useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/Skeleton';
import { api, errorText } from '@/lib/api';
import { formatDate, type Role } from '@/lib/types';

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
}

const ROLES: Role[] = ['cashier', 'supervisor', 'admin', 'auditor'];
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', displayName: '', role: 'cashier' as Role, password: '' });

  const load = () =>
    api<{ items: UserRow[] }>('/api/admin/users')
      .then((r) => setUsers(r.items))
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoaded(true));
  useEffect(() => {
    load();
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await run(() => api('/api/admin/users', { method: 'POST', body: form }));
    setForm({ username: '', displayName: '', role: 'cashier', password: '' });
  }

  function resetPassword(u: UserRow) {
    const password = window.prompt(`New password for ${u.username} (min 10 characters)`);
    if (password) run(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { password } }));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Management</div>
          <h1>Users</h1>
          <p className="subtitle">Accounts and roles. Changing a role, status or password signs the user out.</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card flush table-wrap">
        <table>
          <thead>
            <tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Last login</th><th /></tr>
          </thead>
          <tbody>
            {!loaded && <SkeletonRows cols={6} rows={3} />}
            {users.map((u) => (
              <tr key={u.id}>
                <td className="mono">{u.username}</td>
                <td>
                  <span className="user-cell">
                    <span className={`mini-avatar ${u.active ? '' : 'off'}`}>{initialsOf(u.displayName)}</span>
                    {u.displayName}
                  </span>
                </td>
                <td>
                  <select value={u.role} onChange={(e) => run(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }))}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td><span className={`badge ${u.active ? 'SUCCEEDED' : 'PENDING'}`}>{u.active ? 'Active' : 'Disabled'}</span></td>
                <td className="nowrap muted">{u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}</td>
                <td className="nowrap">
                  <button onClick={() => run(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }))}>
                    {u.active ? 'Disable' : 'Enable'}
                  </button>
                  <button className="ghost" onClick={() => resetPassword(u)}>Reset password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card" onSubmit={create}>
        <h2 style={{ marginTop: 0 }}>Add user</h2>
        <div className="row">
          <div className="field"><label>Username</label><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
          <div className="field"><label>Full name</label><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required /></div>
          <div className="field">
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="field"><label>Initial password</label><input type="password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /></div>
          <div className="field"><button className="primary">Add user</button></div>
        </div>
      </form>
    </>
  );
}
