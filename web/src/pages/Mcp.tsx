import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleX, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/utils';
import { ConfirmDialog, EmptyState, Page, PageHeader, StatusBadge, toastError } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded bg-surface-2 px-2 py-1.5 text-xs">{value}</code>
      <Button size="icon-sm" variant="ghost" aria-label="Copy" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success('Copied'))}><Copy /></Button>
    </div>
  );
}

export default function Mcp() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mcp'], queryFn: () => api.get<any>('/mcp/overview'), refetchInterval: 30_000 });
  const [test, setTest] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [revoke, setRevoke] = useState<any>(null);
  const d = q.data;
  if (!d) return <Page><Spinner /></Page>;
  const active = d.connections.filter((c: any) => c.status === 'active');
  return (
    <Page>
      <PageHeader title="MCP Integration" description="Remote Model Context Protocol server for ChatGPT and other MCP clients." actions={<Button variant="outline" disabled={testing} onClick={async () => { setTesting(true); try { setTest(await api.post('/mcp/test')); } catch (e) { toastError(e); } finally { setTesting(false); } }}>{testing ? 'Testing…' : 'Test connection'}</Button>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><div><CardTitle>Server</CardTitle><CardDescription>{d.transport} · {d.authentication}</CardDescription></div><StatusBadge status="active" /></CardHeader>
          <CardContent className="grid gap-3 text-[13px]">
            <div><p className="mb-1 text-xs text-muted">MCP server URL</p><CopyField value={d.server_url} /></div>
            <div><p className="mb-1 text-xs text-muted">Protected resource metadata</p><CopyField value={d.protected_resource_metadata} /></div>
            <div><p className="mb-1 text-xs text-muted">Authorisation server metadata</p><CopyField value={d.authorization_server_metadata} /></div>
            <p className="text-xs text-muted">Last successful tool call: {d.last_successful_request ? `${fmtDateTime(d.last_successful_request)} (${timeAgo(d.last_successful_request)})` : 'none yet'} · {active.length} active connection(s)</p>
            {test && (
              <ul className="grid gap-1 rounded-md border p-2.5">
                {test.results.map((r: any) => <li key={r.check} className="flex items-start gap-2 text-xs">{r.ok ? <CheckCircle2 className="size-4 text-success" /> : <CircleX className="size-4 text-danger" />}<span className="font-medium">{r.check}</span><span className="text-muted">{r.detail}</span></li>)}
                <li className="text-xs text-muted">{test.note}</li>
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Connect ChatGPT</CardTitle></CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1.5 pl-4 text-[13px]">
              <li>In ChatGPT, open <strong>Settings → Apps &amp; Connectors</strong> (developer mode may need to be enabled for custom connectors on your plan).</li>
              <li>Create a connector and enter the MCP server URL above. Choose <strong>OAuth</strong> authentication.</li>
              <li>ChatGPT registers itself and opens a sign-in window. Sign in here, choose the WhatsApp accounts, permissions and send policy, then allow access.</li>
              <li>Ask: “List my connected WhatsApp accounts.”</li>
            </ol>
            <p className="mt-3 text-xs text-muted">The server must be reachable over valid HTTPS from the internet. On the consent screen choose how messages are confirmed: in ChatGPT, in this dashboard, either, read-only or direct. You can change it per connection below.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><div><CardTitle>Connected clients</CardTitle><CardDescription>Each connection is a user's grant to one OAuth client. Revoking takes effect immediately.</CardDescription></div></CardHeader>
        {!d.connections.length && <EmptyState title="No MCP clients connected yet" />}
        {d.connections.length > 0 && (
          <Table>
            <THead><TR><TH>Client</TH><TH>Authorised by</TH><TH className="hidden md:table-cell">Accounts</TH><TH className="hidden lg:table-cell">Permissions</TH><TH>Send policy</TH><TH>Last used</TH><TH /></TR></THead>
            <TBody>
              {d.connections.map((c: any) => (
                <TR key={c.id}>
                  <TD><p className="font-medium">{c.client.name}</p><StatusBadge status={c.status} />{c.revoked_reason && <p className="text-[11px] text-muted">{c.revoked_reason.replace(/_/g, ' ')}</p>}</TD>
                  <TD className="text-xs">{c.user.name}<p className="text-muted">{c.user.email}</p></TD>
                  <TD className="hidden text-xs md:table-cell">{c.accounts.map((a: any) => a.name).join(', ')}</TD>
                  <TD className="hidden lg:table-cell"><div className="flex max-w-64 flex-wrap gap-1">{c.scopes.map((s: string) => <Badge key={s}>{s}</Badge>)}</div></TD>
                  <TD>
                    {c.status === 'active' ? (
                      <NativeSelect className="h-8 w-auto text-xs" value={c.approval_policy.toUpperCase()} onChange={async (e) => { try { await api.patch(`/mcp/connections/${c.id}`, { approval_policy: e.target.value }); qc.invalidateQueries({ queryKey: ['mcp'] }); toast.success('Policy updated'); } catch (err) { toastError(err); } }}>
                        <option value="CONFIRM_IN_CHAT">Confirm in ChatGPT</option><option value="CONFIRM_IN_CHAT_OR_DASHBOARD">ChatGPT or dashboard</option><option value="REQUIRE_APPROVAL">Dashboard approval</option><option value="READ_ONLY">Read-only</option><option value="DIRECT">Direct sending</option>
                      </NativeSelect>
                    ) : <span className="text-xs text-muted">{c.approval_policy.replace('_', ' ')}</span>}
                  </TD>
                  <TD className="text-xs text-muted">{timeAgo(c.last_used_at)}{c.last_error && <p className="max-w-48 truncate text-danger" title={c.last_error}>{c.last_error}</p>}</TD>
                  <TD>{c.status === 'active' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevoke(c)}>Revoke</Button>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent tool activity</CardTitle></CardHeader>
          {!d.recent_activity.length && <EmptyState title="No tool calls yet" />}
          <ul className="max-h-80 divide-y overflow-y-auto text-xs">
            {d.recent_activity.map((a: any, i: number) => <li key={i} className="flex items-center gap-2 px-4 py-1.5"><code>{a.tool}</code><span className="truncate text-muted">{a.actor}</span><StatusBadge status={a.result} className="ml-auto" /><span className="w-20 text-right text-muted">{timeAgo(a.timestamp)}</span></li>)}
          </ul>
        </Card>
        <Card>
          <CardHeader><CardTitle>Errors</CardTitle></CardHeader>
          {!d.errors.length && <EmptyState title="No connection errors" />}
          <ul className="max-h-80 divide-y overflow-y-auto text-xs">
            {d.errors.map((a: any, i: number) => <li key={i} className="px-4 py-1.5"><div className="flex gap-2"><code>{a.action}</code><StatusBadge status={a.result} /><span className="ml-auto text-muted">{timeAgo(a.timestamp)}</span></div>{a.metadata?.error && <p className="text-muted">{a.metadata.error}</p>}</li>)}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Available tools ({d.tools.length})</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">{d.tools.map((t: string) => <Badge key={t} className="font-mono">{t}</Badge>)}</CardContent>
      </Card>

      {revoke && <ConfirmDialog open onOpenChange={(o) => !o && setRevoke(null)} destructive title={`Revoke ${revoke.client.name}?`} description="All access and refresh tokens for this connection stop working immediately." confirmLabel="Revoke access" onConfirm={async () => { await api.post(`/mcp/connections/${revoke.id}/revoke`); qc.invalidateQueries({ queryKey: ['mcp'] }); }} />}
    </Page>
  );
}
