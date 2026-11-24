import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, idempotencyKey, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Scheduled } from '@/lib/types';
import { useSocketEvent } from '@/lib/socket';
import { displayTimezone, fmtDateTime, toLocalInput } from '@/lib/utils';
import { AccountSelect, ConfirmDialog, EmptyState, Page, PageHeader, Pager, StatusBadge, toastError, useAccountName } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

const STATUSES = ['', 'pending', 'awaiting_approval', 'processing', 'sent', 'failed', 'cancelled', 'expired', 'delivery_uncertain'];

function Editor({ initial, onClose }: { initial: Scheduled | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState(initial?.account_id ?? '');
  const [recipient, setRecipient] = useState('');
  const [text, setText] = useState(initial?.body ?? '');
  const [when, setWhen] = useState(initial ? toLocalInput(initial.scheduled_at) : toLocalInput(new Date(Date.now() + 3600_000)));
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title={initial ? 'Edit scheduled message' : 'Schedule a message'} description={`Times are in ${displayTimezone()}.`} />
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (initial) await api.patch(`/scheduled-messages/${initial.id}`, { text, scheduled_at: when, timezone: displayTimezone() });
            else {
              const r = recipient.trim();
              const target = /@(c\.us|g\.us|lid)$/.test(r) ? { chat_id: r } : /^[+\d][\d\s()-]{6,}$/.test(r) ? { phone_number: r } : { name: r };
              await api.post('/scheduled-messages', { account_id: accountId, ...target, text, scheduled_at: when, timezone: displayTimezone() }, { 'idempotency-key': idempotencyKey() });
            }
            toast.success(initial ? 'Updated' : 'Scheduled');
            qc.invalidateQueries({ queryKey: ['scheduled'] });
            onClose();
          } catch (err) {
            toastError(err);
          } finally {
            setBusy(false);
          }
        }}>
          {!initial && (
            <>
              <Field label="Send from" htmlFor="acc"><AccountSelect value={accountId} onChange={setAccountId} allowAll={false} className="w-full" /></Field>
              <Field label="Recipient" htmlFor="rc" hint="International phone number (+44 7700 900123), exact contact name, or chat ID."><Input id="rc" required value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>
            </>
          )}
          {initial && <p className="text-[13px] text-muted">To {initial.recipient_label ?? initial.recipient_wa_id}</p>}
          <Field label="Message" htmlFor="tx"><Textarea id="tx" required rows={4} maxLength={4096} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Field label="Send at" htmlFor="wh"><Input id="wh" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!initial && !accountId)}>{initial ? 'Save changes' : 'Schedule'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ScheduledPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const accName = useAccountName();
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState('pending,awaiting_approval');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Scheduled | null | 'new'>(null);
  const [cancel, setCancel] = useState<Scheduled | null>(null);
  const limit = 50;
  const q = useQuery({ queryKey: ['scheduled', accountId, status, offset], queryFn: () => api.page<Scheduled>(`/scheduled-messages${qs({ account_id: accountId, status, limit, offset })}`) });
  useSocketEvent('scheduled.changed', () => qc.invalidateQueries({ queryKey: ['scheduled'] }));
  const items = q.data?.data ?? [];
  return (
    <Page>
      <PageHeader title="Scheduled Messages" description="Stored in the database and delivered by the built-in scheduler, including after restarts." actions={can('schedule:write') && <Button onClick={() => setEditing('new')}><Plus /> Schedule message</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <AccountSelect value={accountId} onChange={(v) => { setAccountId(v); setOffset(0); }} />
          <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className="w-auto" aria-label="Status filter">
            <option value="pending,awaiting_approval">Upcoming</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </NativeSelect>
        </div>
        {q.isLoading && <div className="p-6"><Spinner /></div>}
        {!q.isLoading && !items.length && <EmptyState title="No scheduled messages" />}
        {items.length > 0 && (
          <Table>
            <THead><TR><TH>Send at</TH><TH>Recipient</TH><TH className="hidden md:table-cell">Message</TH><TH>Status</TH><TH className="hidden lg:table-cell">Created by</TH><TH /></TR></THead>
            <TBody>
              {items.map((s) => (
                <TR key={s.id}>
                  <TD className="whitespace-nowrap">{fmtDateTime(s.scheduled_at)}<p className="text-[11px] text-muted">{s.timezone}</p></TD>
                  <TD><p>{s.recipient_label ?? s.recipient_wa_id}</p><p className="text-[11px] text-muted">{accName(s.account_id)}</p></TD>
                  <TD className="hidden max-w-xs md:table-cell"><p className="line-clamp-2">{s.body}</p>{s.attachment_id && <p className="text-[11px] text-muted">+ attachment</p>}</TD>
                  <TD><StatusBadge status={s.status} />{s.error && <p className="mt-1 max-w-56 text-[11px] text-muted">{s.error}</p>}</TD>
                  <TD className="hidden text-xs text-muted lg:table-cell">{s.created_by.label ?? s.created_by.type}</TD>
                  <TD className="text-right whitespace-nowrap">
                    {['pending', 'awaiting_approval'].includes(s.status) && can('schedule:write', s.account_id, 'send') && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setCancel(s)}>Cancel</Button>
                      </>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pager total={q.data?.meta?.pagination?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} />
      </Card>
      {editing && <Editor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {cancel && <ConfirmDialog open onOpenChange={(o) => !o && setCancel(null)} destructive title="Cancel scheduled message?" description="It will not be sent." confirmLabel="Cancel message" onConfirm={async () => { await api.del(`/scheduled-messages/${cancel.id}`); qc.invalidateQueries({ queryKey: ['scheduled'] }); }} />}
    </Page>
  );
}
