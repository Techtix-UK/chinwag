import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, BookOpen, CalendarClock, ChevronsLeft, ChevronsRight, CircleCheck, Contact, Gauge, KeyRound, LayoutDashboard, LogOut, Menu,
  MessagesSquare, Monitor, Moon, Plug, Settings, Smartphone, Sun, User, Users, Webhook, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getSocket, resetSocket, useSocketEvent } from '@/lib/socket';
import { useThemePref } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { ProductLockup, TechtixIcon } from '../Brand';
import { Avatar, Tooltip } from '../ui/misc';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  cap?: string;
  badge?: 'unread' | 'approvals';
}

const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [
    { to: '/', label: 'Overview', icon: LayoutDashboard, cap: 'accounts:read' },
    { to: '/inbox', label: 'Inbox', icon: MessagesSquare, cap: 'chats:read', badge: 'unread' },
    { to: '/contacts', label: 'Contacts', icon: Contact, cap: 'contacts:read' },
    { to: '/accounts', label: 'WhatsApp Accounts', icon: Smartphone, cap: 'accounts:read' },
    { to: '/scheduled', label: 'Scheduled Messages', icon: CalendarClock, cap: 'schedule:read' },
    { to: '/approvals', label: 'Message Approvals', icon: CircleCheck, cap: 'approvals:review', badge: 'approvals' },
  ] },
  { section: 'Integrations', items: [
    { to: '/integrations/mcp', label: 'MCP Integration', icon: Plug, cap: 'integrations:manage' },
    { to: '/api-keys', label: 'API Credentials', icon: KeyRound, cap: 'integrations:manage' },
    { to: '/webhooks', label: 'Webhooks', icon: Webhook, cap: 'webhooks:manage' },
  ] },
  { section: 'Administration', items: [
    { to: '/activity', label: 'Activity Logs', icon: Activity, cap: 'audit:read' },
    { to: '/users', label: 'Users & Permissions', icon: Users, cap: 'users:manage' },
    { to: '/health', label: 'System Health', icon: Gauge, cap: 'system:read' },
    { to: '/settings', label: 'Settings', icon: Settings, cap: 'settings:manage' },
  ] },
];

function Logo({ collapsed }: { collapsed: boolean }) {
  const { me } = useAuth();
  return (
    <div className={cn('flex h-14 items-center px-3.5', collapsed && 'justify-center px-0')}>
      {collapsed ? <TechtixIcon className="size-6" /> : <ProductLockup customUrl={me?.app.logo_url} />}
      <span className="sr-only">{me?.app.name ?? 'Techtix WhatsApp'}</span>
    </div>
  );
}

export function AppShell() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ttw:sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pref, setPref] = useThemePref();
  const [connected, setConnected] = useState(true);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => localStorage.setItem('ttw:sidebar', collapsed ? 'collapsed' : 'expanded'), [collapsed]);
  useEffect(() => {
    const s = getSocket();
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on('connect', on);
    s.on('disconnect', off);
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
    };
  }, []);

  const counts = useQuery({
    queryKey: ['nav-counts'],
    queryFn: async () => {
      const [unread, approvals] = await Promise.all([
        can('chats:read') ? api.page('/chats?filter=unread&limit=1') : null,
        can('approvals:review') ? api.page('/approvals?status=pending&limit=1') : null,
      ]);
      return { unread: unread?.meta?.pagination?.total ?? 0, approvals: approvals?.meta?.pagination?.total ?? 0 };
    },
    refetchInterval: 60_000,
  });
  useSocketEvent('chat.upsert', () => qc.invalidateQueries({ queryKey: ['nav-counts'] }));
  useSocketEvent('approval.changed', () => qc.invalidateQueries({ queryKey: ['nav-counts'] }));
  useSocketEvent('account.status', () => qc.invalidateQueries({ queryKey: ['accounts'] }));

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    resetSocket();
    qc.setQueryData(['me'], null);
    navigate('/login');
  };

  const sidebar = (isMobile: boolean) => {
    const c = collapsed && !isMobile;
    return (
      <nav aria-label="Main" className="flex h-full flex-col">
        <Logo collapsed={c} />
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {NAV.map((group, gi) => {
            const items = group.items.filter((i) => !i.cap || can(i.cap));
            if (!items.length) return null;
            return (
              <div key={gi} className="mt-3 first:mt-1">
                {group.section && !c ? <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted">{group.section}</p> : null}
                {group.section && c ? <div className="mx-2 my-2 h-px bg-border" /> : null}
                <ul className="grid gap-0.5">
                  {items.map((item) => {
                    const count = item.badge ? counts.data?.[item.badge] ?? 0 : 0;
                    const link = (
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        className={({ isActive }) => cn('flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-foreground', isActive && 'bg-accent font-medium text-foreground', c && 'justify-center')}
                      >
                        <item.icon className="size-4 shrink-0" />
                        {!c && <span className="flex-1 truncate">{item.label}</span>}
                        {!c && count > 0 && <span className="rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">{count > 99 ? '99+' : count}</span>}
                        {c && <span className="sr-only">{item.label}</span>}
                      </NavLink>
                    );
                    return <li key={item.to}>{c ? <Tooltip content={item.label}>{link}</Tooltip> : link}</li>;
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        {!isMobile && (
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" className={cn('w-full text-muted', c ? 'justify-center' : 'justify-start')} onClick={() => setCollapsed((v) => !v)} aria-label={c ? 'Expand sidebar' : 'Collapse sidebar'}>
              {c ? <ChevronsRight /> : <ChevronsLeft />}
              {!c && 'Collapse'}
            </Button>
          </div>
        )}
      </nav>
    );
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className={cn('hidden shrink-0 border-r bg-surface transition-[width] md:block', collapsed ? 'w-14' : 'w-60')}>{sidebar(false)}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r bg-surface shadow-xl">
            <Button variant="ghost" size="icon-sm" className="absolute right-2 top-3" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
              <X />
            </Button>
            {sidebar(true)}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-surface px-3 md:px-5">
          <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="flex-1" />
          {!connected && <span className="text-xs text-warning">Live updates reconnecting…</span>}
          <a href="/api/docs" target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-foreground sm:flex">
            <BookOpen className="size-4" /> API docs
          </a>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-surface-2" aria-label="Account menu">
                <Avatar name={me?.name} className="size-7" />
                <span className="hidden text-[13px] font-medium sm:block">{me?.name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>
                <span className="block font-medium text-foreground">{me?.name}</span>
                <span className="block truncate">{me?.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/profile')}>
                <User /> Profile & security
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={pref} onValueChange={(v) => setPref(v as any)}>
                <DropdownMenuRadioItem value="system"><Monitor className="size-4" /> System</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light"><Sun className="size-4" /> Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark"><Moon className="size-4" /> Dark</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={logout}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
