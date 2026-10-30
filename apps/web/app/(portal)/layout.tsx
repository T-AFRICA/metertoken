'use client';

import Image from 'next/image';
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
  const [menuOpen, setMenuOpen] = useState(false);

  // The phone menu closes itself on navigation and on Escape.
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

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
  const current = NAV.flatMap((g) => g.items.map((i) => ({ group: g.label, label: i.label, href: i.href }))).find((i) => path?.startsWith(i.href));
  const crumbs = current ? [current.group, current.label] : path?.startsWith('/vends/') ? ['Vending', 'Transactions', 'Detail'] : [];
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
        <header className="mobile-bar">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}>
            <Icon name="menu" size={22} />
          </button>
          <Link href="/vend" className="mobile-logo">
            <Image src="/tronic-logo-white.png" alt="Tronic" width={667} height={148} priority />
          </Link>
          <span className={`env-tag ${me.adapterMode}`}><b>{me.adapterMode === 'mock' ? 'TEST' : 'LIVE'}</b></span>
        </header>
        {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden />}

        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="sidebar-top">
            <Link href="/vend" className="wordmark">
              <Image src="/tronic-logo-white.png" alt="Tronic" width={667} height={148} priority />
              <span>Token desk</span>
            </Link>
            <button className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <Icon name="x" size={20} />
            </button>
          </div>
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
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={c} className={i === crumbs.length - 1 ? 'here' : ''}>{c}</span>
              ))}
            </nav>
            <span className="spacer" />
            <span className="clock">
              {now &&
                `${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
            </span>
            <span className={`env-tag wide ${me.adapterMode}`}>
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
