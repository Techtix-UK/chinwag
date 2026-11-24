import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/utils';
import { EmptyState, Page, PageHeader, Stat, StatusBadge, toastError, useAccountName } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

function dur(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export default function Health() {
  const qc = useQueryClient();
  const accName = useAccountName();
  const q = useQuery({ queryKey: ['health'], queryFn: () => api.get<any>('/system/status'), refetchInterval: 10_000 });
  const d = q.data;
  if (!d) return <Page><Spinner /></Page>;
  const mem = d.host.memory;
  return (
    <Page>
      <PageHeader title="System Health" description={`Refreshes every 10 seconds · ${d.host.hostname}`} actions={<StatusBadge status={d.status} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Uptime" value={dur(d.uptime_seconds)} />
        <Stat label="CPU" value={`${d.host.cpu_percent}%`} hint={`${d.host.cpu_count} cores · load ${d.host.load_average.join(' / ')}`} />
        <Stat label="Memory used" value={`${Math.round(((mem.total_mb - mem.free_mb) / mem.total_mb) * 100)}%`} hint={`App ${mem.process_rss_mb} MB of ${mem.total_mb} MB`} />
        <Stat label="Disk used" value={d.host.disk ? `${d.host.disk.used_percent}%` : '—'} hint={d.host.disk ? `${d.host.disk.free_gb} GB free` : undefined} tone={d.host.disk?.used_percent > 90 ? 'danger' : undefined} />
        <Stat label="WhatsApp clients" value={`${d.whatsapp.connected}/${d.whatsapp.sessions}`} hint="connected / running" />
        <Stat label="Chromium processes" value={d.chromium_processes} hint="Across all account sessions" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Components</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-[13px]">
            <span className="text-muted">Application</span><span>{d.application.version} · {d.application.environment}</span>
            <span className="text-muted">Database</span><span>{d.database.ok ? <StatusBadge status="success" /> : <StatusBadge status="failure" />} {d.database.latency_ms} ms</span>
            <span className="text-muted">MCP server</span><span><StatusBadge status="active" /></span>
            <span className="text-muted">Node.js</span><span>{d.versions.node}</span>
            <span className="text-muted">whatsapp-web.js</span><span>{d.versions.whatsapp_web_js}</span>
            <span className="text-muted">Puppeteer</span><span>{d.versions.puppeteer}</span>
            <span className="text-muted">MCP SDK</span><span>{d.versions.mcp_sdk}</span>
            <span className="text-muted">Chromium</span><span className="break-all">{d.versions.chromium ?? <span className="text-danger">{d.versions.chromium_error}</span>}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Queues</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px]">
            <span className="text-muted">Scheduled — pending</span><span className="tabular-nums">{d.queues.scheduled_pending}</span>
            <span className="text-muted">Scheduled — awaiting approval</span><span className="tabular-nums">{d.queues.scheduled_awaiting_approval}</span>
            <span className="text-muted">Scheduled — processing</span><span className="tabular-nums">{d.queues.scheduled_processing}</span>
            <span className="text-muted">Scheduled — delivery uncertain</span><span className={d.queues.scheduled_delivery_uncertain ? 'text-danger tabular-nums' : 'tabular-nums'}>{d.queues.scheduled_delivery_uncertain}</span>
            <span className="text-muted">Webhook backlog</span><span className="tabular-nums">{d.queues.webhook_backlog}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
          {!d.sessions.length && <EmptyState title="No running sessions" />}
          <ul className="divide-y text-[13px]">
            {d.sessions.map((s: any) => (
              <li key={s.account_id} className="flex items-center gap-2 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{accName(s.account_id)}</p>
                  <p className="text-xs text-muted">{s.resources?.pid ? `${s.resources.memory_mb} MB · ${s.resources.cpu_percent}% CPU · ${s.resources.processes} procs` : 'No browser process'}{s.retries ? ` · ${s.retries} recovery attempts` : ''}</p>
                </div>
                <StatusBadge status={s.status} />
                <Button size="sm" variant="ghost" onClick={async () => { try { await api.post(`/system/sessions/${s.account_id}/restart`); toast.success('Restart requested'); qc.invalidateQueries({ queryKey: ['health'] }); } catch (e) { toastError(e); } }}>Restart</Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>Recent errors and warnings</CardTitle></CardHeader>
        {!d.recent_errors.length && <EmptyState title="No recent errors" />}
        {d.recent_errors.length > 0 && (
          <Table>
            <THead><TR><TH>Time</TH><TH>Level</TH><TH>Component</TH><TH>Account</TH><TH>Message</TH></TR></THead>
            <TBody>
              {d.recent_errors.map((e: any) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-xs" title={fmtDateTime(e.timestamp)}>{timeAgo(e.timestamp)}</TD>
                  <TD><StatusBadge status={e.level === 'error' ? 'failure' : 'pending'} /></TD>
                  <TD className="text-xs">{e.component}</TD>
                  <TD className="text-xs">{e.account_id ? accName(e.account_id) : '—'}</TD>
                  <TD className="text-xs">{e.message}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </Page>
  );
}
