import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Account, Chat } from '@/lib/types';
import { useSocketEvent } from '@/lib/socket';
import { chatTitle, fmtRelativeShort, timeAgo } from '@/lib/utils';
import { EmptyState, Page, PageHeader, Stat, StatusBadge, useAccountName } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';

interface OverviewData {
  accounts: Account[];
  stats: Record<string, number>;
  recent_conversations: Chat[];
  recent_activity: { id: string; timestamp: string; action: string; actor: string | null; account_id: string | null; result: string }[];
  system: { status: string; uptime_seconds: number; database: { ok: boolean; latency_ms: number | null }; whatsapp: { connected: number; sessions: number } };
}

export default function Overview() {
  const qc = useQueryClient();
  const accName = useAccountName();
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get<OverviewData>('/overview'), refetchInterval: 30_000 });
  useSocketEvent('message.upsert', () => qc.invalidateQueries({ queryKey: ['overview'] }));
  useSocketEvent('account.status', () => qc.invalidateQueries({ queryKey: ['overview'] }));
  const d = q.data;
  const s = d?.stats;

  return (
    <Page>
      <PageHeader title="Overview" description="Live figures from your connected WhatsApp accounts." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {s ? (
          <>
            <Stat label="Connected accounts" value={s.connected_accounts} />
            <Stat label="Disconnected" value={s.disconnected_accounts} tone={s.disconnected_accounts ? 'warning' : undefined} />
            <Stat label="Unread conversations" value={s.unread_conversations} />
            <Stat label="Received today" value={s.messages_received_today} />
            <Stat label="Sent today" value={s.messages_sent_today} />
            <Stat label="Scheduled pending" value={s.pending_scheduled} />
            <Stat label="Approvals pending" value={s.pending_approvals} tone={s.pending_approvals ? 'warning' : undefined} />
          </>
        ) : (
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[74px]" />)
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent conversations</CardTitle>
            <Button asChild variant="link" size="sm"><Link to="/inbox">Open inbox</Link></Button>
          </CardHeader>
          {d && !d.recent_conversations.length && <EmptyState title="No conversations yet" description="Connect a WhatsApp account to start synchronising conversations." />}
          <ul className="divide-y">
            {d?.recent_conversations.map((c) => (
              <li key={c.id}>
                <Link to={`/inbox/${c.account_id}/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                  <Avatar src={c.profile_pic_url} name={chatTitle(c)} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{chatTitle(c)}</p>
                    <p className="truncate text-xs text-muted">{c.last_message_preview ?? '—'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted">{fmtRelativeShort(c.last_message_at)}</p>
                    <p className="text-[11px] text-muted">{accName(c.account_id)}</p>
                  </div>
                  {c.unread_count > 0 && <span className="rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{c.unread_count}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Accounts</CardTitle><Button asChild variant="link" size="sm"><Link to="/accounts">Manage</Link></Button></CardHeader>
            {d && !d.accounts.length && <EmptyState title="No WhatsApp accounts" action={<Button asChild size="sm"><Link to="/accounts">Add account</Link></Button>} />}
            <ul className="divide-y">
              {d?.accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar src={a.profile_pic_url} name={a.display_name} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{a.display_name}</p>
                    <p className="text-xs text-muted">{a.phone_number ?? 'Not linked'}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader><CardTitle>System</CardTitle>{d && <StatusBadge status={d.system.status} />}</CardHeader>
            <CardContent className="grid grid-cols-2 gap-y-1.5 text-[13px]">
              <span className="text-muted">Database</span><span>{d ? (d.system.database.ok ? `OK · ${d.system.database.latency_ms} ms` : 'Unavailable') : '—'}</span>
              <span className="text-muted">Live sessions</span><span>{d ? `${d.system.whatsapp.connected} of ${d.system.whatsapp.sessions}` : '—'}</span>
              <span className="text-muted">Uptime</span><span>{d ? `${Math.floor(d.system.uptime_seconds / 3600)} h ${Math.floor((d.system.uptime_seconds % 3600) / 60)} m` : '—'}</span>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Recent account activity</CardTitle></CardHeader>
        {d && !d.recent_activity.length && <EmptyState title="No account activity yet" />}
        <ul className="divide-y text-[13px]">
          {d?.recent_activity.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">
              <code className="text-xs">{a.action}</code>
              <span className="text-muted">{accName(a.account_id)}</span>
              <span className="text-muted">{a.actor ?? 'System'}</span>
              <span className="ml-auto text-xs text-muted">{timeAgo(a.timestamp)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
