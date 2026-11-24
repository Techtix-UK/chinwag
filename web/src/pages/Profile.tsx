import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useThemePref } from '@/lib/theme';
import { TIMEZONES, timeAgo } from '@/lib/utils';
import { Page, PageHeader, toastError } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/input';

export default function Profile() {
  const { me, refresh } = useAuth();
  const qc = useQueryClient();
  const [pref, setPref, resolved] = useThemePref();
  const [name, setName] = useState(me?.name ?? '');
  const [tz, setTz] = useState(me?.timezone ?? '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<any[]>('/auth/sessions') });
  return (
    <Page className="max-w-3xl">
      <PageHeader title="Profile & security" />
      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); try { await api.patch('/auth/me', { name, timezone: tz }); await refresh(); toast.success('Saved'); } catch (err) { toastError(err); } }}>
              <Field label="Name" htmlFor="pn"><Input id="pn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Display timezone" htmlFor="ptz" hint="All times are stored in UTC and shown in this timezone."><NativeSelect id="ptz" value={tz} onChange={(e) => setTz(e.target.value)}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</NativeSelect></Field>
              <Field label="Appearance" htmlFor="pth" hint={pref === 'system' ? `Following your system (currently ${resolved})` : undefined}>
                <NativeSelect id="pth" value={pref} onChange={(e) => setPref(e.target.value as any)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></NativeSelect>
              </Field>
              <div className="flex items-end justify-end"><Button type="submit">Save profile</Button></div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-3" onSubmit={async (e) => {
              e.preventDefault();
              if (pw.next !== pw.confirm) return toast.error('Passwords do not match');
              try { await api.post('/auth/password', { current_password: pw.current, new_password: pw.next }); setPw({ current: '', next: '', confirm: '' }); toast.success('Password changed — other sessions were signed out'); qc.invalidateQueries({ queryKey: ['sessions'] }); } catch (err) { toastError(err); }
            }}>
              <Field label="Current password" htmlFor="c1"><Input id="c1" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
              <Field label="New password" htmlFor="c2"><Input id="c2" type="password" autoComplete="new-password" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
              <Field label="Confirm" htmlFor="c3"><Input id="c3" type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
              <div className="sm:col-span-3 flex justify-end"><Button type="submit">Change password</Button></div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Active sessions</CardTitle></CardHeader>
          <ul className="divide-y text-[13px]">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1"><p className="truncate">{s.user_agent ?? 'Unknown browser'}</p><p className="text-xs text-muted">{s.ip_address} · active {timeAgo(s.last_seen_at)}</p></div>
                {s.current ? <Badge tone="info">This device</Badge> : <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { await api.del(`/auth/sessions/${s.id}`); sessions.refetch(); }}>Sign out</Button>}
              </li>
            ))}
          </ul>
        </Card>
        <p className="text-xs text-muted">Roles: {me?.roles.join(', ')}</p>
      </div>
    </Page>
  );
}
