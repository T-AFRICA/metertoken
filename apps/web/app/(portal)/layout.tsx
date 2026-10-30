'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { api, setCsrfToken } from '@/lib/api';
import { canVend, isSupervisor, type Me, type Role } from '@/lib/types';
import { SessionContext } from './session';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  show: (r: Role) => boolean;
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: 'Vending',
    items: [
      { href: '/vend', label: 'Generate token', icon: 'bolt', show: canVend },
      { href: '/history', label: 'Transactions', icon: 'history', show: () => true },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/admin/reports', label: 'Reports', icon: 'chart', show: (r) => isSupervisor(r) || r === 'auditor' },
      { href: '/admin/tariffs', label: 'Tariffs', icon: 'tag', show: (r) => r !== 'cashier' },
      { href: '/admin/users', label: 'Users', icon: 'users', show: (r) => r === 'admin' },
      { href: '/admin/audit', label: 'Activity log', icon: 'shield', show: (r) => r === 'admin' || r === 'auditor' },
      { href: '/admin/settings', label: 'Settings', icon: 'settings', show: (r) => r === 'admin' },
    ],
  },
];

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const path = usePathname();
  const now = useClock();

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
  const initials = me.user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  return (
    <SessionContext.Provider value={me}>
      <div className="shell">
        <aside className="sidebar">
          <Link href="/vend" className="wordmark">
            <b>TR<i>O</i>NIC</b>
            <span>Token desk</span>
          </Link>
          {NAV.map((group) => {
            const items = group.items.filter((i) => i.show(role));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-label">{group.label}</div>
                {items.map((i) => (
                  <Link key={i.href} href={i.href} className={`nav-item ${path?.startsWith(i.href) ? 'active' : ''}`}>
                    <Icon name={i.icon} />
                    {i.label}
                  </Link>
                ))}
              </div>
            );
          })}
          <div className="side-foot">
            <div className="user-card">
              <div className="avatar">{initials}</div>
              <div>
                <div className="name">{me.user.displayName}</div>
                <div className="role">{role}</div>
              </div>
            </div>
            <button className="signout" onClick={logout}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </div>
        </aside>

        <div className="content">
          <div className="content-top">
            <span className="clock">
              {now &&
                `${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
            </span>
            <span className={`env-tag ${me.adapterMode}`}>
              {me.adapterMode === 'mock' ? (
                <>Practice tokens — they won’t load on a real meter <b>TEST</b></>
              ) : (
                <>Connected to the vendor <b>LIVE</b></>
              )}
            </span>
          </div>
          <main>{children}</main>
        </div>
      </div>
    </SessionContext.Provider>
  );
}
