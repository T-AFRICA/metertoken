'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, setCsrfToken } from '@/lib/api';
import { canVend, isSupervisor, type Me } from '@/lib/types';
import { SessionContext } from './session';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const path = usePathname();

  useEffect(() => {
    api<Me>('/api/auth/me')
      .then((m) => {
        setCsrfToken(m.csrfToken);
        setMe(m);
      })
      .catch(() => {
        window.location.href = '/login';
      });
  }, []);

  if (!me) return <main className="hint">Loading…</main>;

  const role = me.user.role;
  const links: [string, string][] = [
    ...(canVend(role) ? ([['/vend', 'Generate token']] as [string, string][]) : []),
    ['/history', 'History'],
    ...(isSupervisor(role) || role === 'auditor' ? ([['/admin/reports', 'Reports']] as [string, string][]) : []),
    ...(role === 'admin' || role === 'supervisor' || role === 'auditor' ? ([['/admin/tariffs', 'Tariffs']] as [string, string][]) : []),
    ...(role === 'admin' ? ([['/admin/users', 'Users'], ['/admin/settings', 'Settings']] as [string, string][]) : []),
    ...(role === 'admin' || role === 'auditor' ? ([['/admin/audit', 'Activity log']] as [string, string][]) : []),
  ];

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  return (
    <SessionContext.Provider value={me}>
      {me.adapterMode === 'mock' && (
        <div className="mock-banner">MOCK MODE — tokens shown here are NOT valid on real meters</div>
      )}
      <header className="topbar">
        <Link href="/vend" className="brand">Tronic Token Portal</Link>
        <nav className="nav">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={path?.startsWith(href) ? 'active' : ''}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="who">
          <span>
            {me.user.displayName} · {role}
          </span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>
      <main>{children}</main>
    </SessionContext.Provider>
  );
}
