import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import type { Approval } from '@/lib/types';
import { useSocketEvent } from '@/lib/socket';
import { fmtDateTime, timeAgo } from '@/lib/utils';
import { EmptyState, Page, PageHeader, Pager, StatusBadge, toastError, useAccountName } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';

function Payload({ a }: { a: Approval }) {
  const p = a.payload ?? {};
  return (
    <div className="grid gap-1.5 text-[13px]">
      {p.kind === 'text' && <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-2.5">{p.text}</p>}
      {p.kind === 'media' && (
        <div className="rounded-md bg-surface-2 p-2.5">
          <a className="text-primary underline" href={`/api/v1/media/${p.attachment_id}?download=1`}>Attachment</a> <span className="text-xs text-muted">sha256 {String(p.attachment_checksum).slice(0, 12)}… · sent as {p.send_as}</span>
          {p.caption && <p className="mt-1 whitespace-pre-wrap">{p.caption}</p>}
        </div>
      )}
      {p.kind === 'reaction' && <p className="rounded-md bg-surface-2 p-2.5">React with {p.emoji || '(remove reaction)'} to message {p.message_id}</p>}
      {p.quoted_message_id && <p className="text-xs text-muted">Reply to message {p.quoted_message_id}</p>}
    </div>
  );
}

export default function Approvals() {
  const qc = useQueryClient();
  const accName = useAccountName();
  const [status, setStatus] = useState('pending');
  const [offset, setOffset] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const limit = 25;
  const q = useQuery({ queryKey: ['approvals', status, offset], queryFn: () => api.page<Approval>(`/approvals${qs({ status: status || undefined, limit, offset })}`) });
  useSocketEvent('approval.changed', () => qc.invalidateQueries({ queryKey: ['approvals'] }));
  const decide = async (a: Approval, d: 'approve' | 'reject') => {
    try {
      const r = await api.post<Approval>(`/approvals/${a.id}/${d}`, { note: notes[a.id] || undefined });
      toast[r.status === 'failed' ? 'error' : 'success'](r.status === 'executed' ? 'Approved and sent' : r.status === 'approved' ? 'Approved — will send at the scheduled time' : r.status === 'failed' ? `Approved but sending failed: ${r.error}` : 'Rejected');
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
    } catch (e) {
      toastError(e);
    }
  };
  const items = q.data?.data ?? [];
  return (
    <Page className="max-w-4xl">
      <PageHeader title="Message Approvals" description="Outbound messages requested by integrations. Approval applies to this exact content and recipient; any change requires a new approval." />
      <Tabs value={status} onValueChange={(v) => { setStatus(v); setOffset(0); }} className="mb-3">
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="executed">Sent</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
          <TabsTrigger value="">All</TabsTrigger>
        </TabsList>
      </Tabs>
      {!q.isLoading && !items.length && <Card><EmptyState title={status === 'pending' ? 'Nothing awaiting approval' : 'No approvals'} /></Card>}
      <div className="grid gap-3">
        {items.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold">To {a.recipient_label ?? a.recipient_wa_id} <span className="font-normal text-muted">via {accName(a.account_id)}</span></p>
                <p className="text-xs text-muted">Requested by {a.requested_by.label ?? a.requested_by.type} · {timeAgo(a.created_at)} · {a.kind}{a.scheduled_message_id ? ' · scheduled message' : ''}</p>
              </div>
              <StatusBadge status={a.status} />
            </div>
            <div className="mt-3"><Payload a={a} /></div>
            {a.error && <p className="mt-2 text-xs text-danger">{a.error}</p>}
            {a.decided_at && <p className="mt-2 text-xs text-muted">Decided {fmtDateTime(a.decided_at)}{a.decision_note ? ` — ${a.decision_note}` : ''}</p>}
            {a.status === 'pending' && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Input className="min-w-48 flex-1" placeholder="Optional note" value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                <Button variant="outline" onClick={() => decide(a, 'reject')}>Reject</Button>
                <Button onClick={() => decide(a, 'approve')}>{a.scheduled_message_id ? 'Approve' : 'Approve and send'}</Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <Pager total={q.data?.meta?.pagination?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} />
    </Page>
  );
}
