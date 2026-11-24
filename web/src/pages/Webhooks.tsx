import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/utils';
import { ConfirmDialog, EmptyState, Page, PageHeader, Pager, SecretReveal, StatusBadge, toastError, useAccounts } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Checkbox, Switch } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

function Editor({ hook, onClose }: { hook: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ['webhook-events'], queryFn: () => api.get<string[]>('/webhooks/events') });
  const { data: accounts } = useAccounts();
  const [f, setF] = useState({ name: hook?.name ?? '', url: hook?.url ?? '', events: (hook?.events ?? ['message.received']) as string[], account_ids: (hook?.account_ids ?? []) as string[], all_accounts: hook?.all_accounts ?? true, enabled: hook?.enabled ?? true });
  const [secret, setSecret] = useState<string | null>(null);
  const toggle = (l: string[], v: string) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader title={secret ? 'Webhook created' : hook ? 'Edit webhook' : 'Create webhook'} description={secret ? undefined : 'Payloads are signed with HMAC-SHA256. Private and local network destinations are blocked unless allowed by the deployment policy.'} />
        {secret ? (
          <>
            <SecretReveal label="Signing secret" value={secret} note="Verify X-Techtix-Signature: t=<timestamp>,v1=HMAC_SHA256(secret, `${timestamp}.${rawBody}`)" />
            <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={async (e) => {
            e.preventDefault();
            try {
              if (hook) { await api.patch(`/webhooks/${hook.id}`, f); onClose(); }
              else { const r = await api.post<{ signing_secret: string }>('/webhooks', f); setSecret(r.signing_secret); }
              qc.invalidateQueries({ queryKey: ['webhooks'] });
            } catch (err) { toastError(err); }
          }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="wn"><Input id="wn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Destination URL" htmlFor="wu"><Input id="wu" type="url" required placeholder="https://example.com/hooks/whatsapp" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">Events</legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">{(events.data ?? []).map((ev) => <label key={ev} className="flex items-center gap-2 text-xs"><Checkbox checked={f.events.includes(ev)} onCheckedChange={() => setF({ ...f, events: toggle(f.events, ev) })} /><code>{ev}</code></label>)}</div>
            </fieldset>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-[13px] font-medium">Accounts</legend>
              <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={f.all_accounts} onCheckedChange={(v) => setF({ ...f, all_accounts: !!v })} /> All accounts</label>
              {!f.all_accounts && (accounts ?? []).map((a) => <label key={a.id} className="flex items-center gap-2 text-[13px]"><Checkbox checked={f.account_ids.includes(a.id)} onCheckedChange={() => setF({ ...f, account_ids: toggle(f.account_ids, a.id) })} /> {a.display_name}</label>)}
            </fieldset>
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} /> Enabled</label>
            <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!f.events.length}>{hook ? 'Save' : 'Create'}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Deliveries({ hook, onClose }: { hook: any; onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const q = useQuery({ queryKey: ['deliveries', hook.id, offset], queryFn: () => api.page<any>(`/webhooks/${hook.id}/deliveries?limit=25&offset=${offset}`), refetchInterval: 10_000 });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide className="max-w-4xl">
        <DialogHeader title={`Deliveries · ${hook.name}`} />
        {q.data && !q.data.data.length && <EmptyState title="No deliveries yet" />}
        {!!q.data?.data.length && (
          <Table>
            <THead><TR><TH>Time</TH><TH>Event</TH><TH>Status</TH><TH>Attempts</TH><TH>Response</TH><TH /></TR></THead>
            <TBody>
              {q.data.data.map((d) => (
                <TR key={d.id}>
                  <TD className="whitespace-nowrap text-xs">{fmtDateTime(d.created_at)}</TD>
                  <TD><code className="text-xs">{d.event}</code></TD>
                  <TD><StatusBadge status={d.status} /></TD>
                  <TD className="text-xs">{d.attempts}{d.status === 'retrying' && <p className="text-muted">next {fmtDateTime(d.next_attempt_at, { timeStyle: 'short' })}</p>}</TD>
                  <TD className="max-w-64 text-xs"><span>{d.response_status ?? '—'}</span> <span className="text-muted">{d.duration_ms ? `${d.duration_ms} ms` : ''}</span>{d.error && <p className="truncate text-danger" title={d.error}>{d.error}</p>}</TD>
                  <TD>{(d.status === 'failed' || d.status === 'succeeded') && <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/webhooks/deliveries/${d.id}/redeliver`); q.refetch(); }}>Redeliver</Button>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pager total={q.data?.meta?.pagination?.total ?? 0} limit={25} offset={offset} onChange={setOffset} />
      </DialogContent>
    </Dialog>
  );
}

export default function Webhooks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['webhooks'], queryFn: () => api.get<any[]>('/webhooks') });
  const [edit, setEdit] = useState<any | null | 'new'>(null);
  const [del, setDel] = useState<any>(null);
  const [deliveries, setDeliveries] = useState<any>(null);
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <Page>
      <PageHeader title="Webhooks" description="Signed HTTPS event notifications with automatic retries and delivery history." actions={<Button onClick={() => setEdit('new')}><Plus /> Create webhook</Button>} />
      {secret && <div className="mb-4"><SecretReveal label="New signing secret" value={secret} note="The previous secret no longer validates." /></div>}
      <Card>
        {q.data && !q.data.length && <EmptyState title="No webhooks configured" />}
        <ul className="divide-y">
          {q.data?.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-60 flex-1">
                <p className="font-medium">{h.name} {!h.enabled && <Badge>Disabled</Badge>}</p>
                <p className="truncate text-xs text-muted">{h.url}</p>
                <div className="mt-1 flex flex-wrap gap-1">{h.events.map((e: string) => <Badge key={e} className="font-mono">{e}</Badge>)}</div>
              </div>
              <p className="text-xs text-muted">7 days: {h.last_7_days.succeeded ?? 0} ok · {h.last_7_days.failed ?? 0} failed · {(h.last_7_days.retrying ?? 0) + (h.last_7_days.pending ?? 0)} queued</p>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={async () => { const r = await api.post<any>(`/webhooks/${h.id}/test`); r.ok ? toast.success(`Test delivered (HTTP ${r.status}, ${r.duration_ms} ms)`) : toast.error(`Test failed: ${r.error ?? 'HTTP ' + r.status}`); }}>Send test</Button>
                <Button size="sm" variant="ghost" onClick={() => setDeliveries(h)}>Deliveries</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(h)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={async () => { try { const r = await api.post<{ signing_secret: string }>(`/webhooks/${h.id}/rotate-secret`); setSecret(r.signing_secret); } catch (e) { toastError(e); } }}>Rotate secret</Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDel(h)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-4">
        <CardContent className="text-[13px] text-muted">
          <p className="font-medium text-foreground">Verifying signatures</p>
          <p className="mt-1">Each request carries <code>X-Techtix-Event</code>, <code>X-Techtix-Event-Id</code> (deduplicate on this), <code>X-Techtix-Timestamp</code> and <code>X-Techtix-Signature: t=…,v1=…</code>. Compute HMAC-SHA256 over <code>{'`${t}.${rawBody}`'}</code> with your signing secret, compare in constant time and reject timestamps older than five minutes.</p>
        </CardContent>
      </Card>
      {edit && <Editor hook={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {deliveries && <Deliveries hook={deliveries} onClose={() => setDeliveries(null)} />}
      {del && <ConfirmDialog open onOpenChange={(o) => !o && setDel(null)} destructive title={`Delete ${del.name}?`} description="Delivery history is deleted as well." confirmLabel="Delete" onConfirm={async () => { await api.del(`/webhooks/${del.id}`); qc.invalidateQueries({ queryKey: ['webhooks'] }); }} />}
    </Page>
  );
}
