import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact } from '@/lib/types';
import { fmtDateTime, timeAgo } from '@/lib/utils';
import { AccountSelect, EmptyState, Page, PageHeader, Pager, toastError, useAccountName } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Avatar, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

function ContactDetail({ c, onClose }: { c: Contact; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const editable = can('contacts:write', c.account_id, 'send');
  const q = useQuery({ queryKey: ['contact', c.account_id, c.id], queryFn: () => api.get<Contact>(`/accounts/${c.account_id}/contacts/${c.id}`) });
  const d = q.data ?? c;
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => setTags((d.tags ?? []).join(', ')), [q.data]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['contact', c.account_id, c.id] }); qc.invalidateQueries({ queryKey: ['contacts'] }); };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader title={d.name} description={d.phone_number ?? d.wa_id} />
        <div className="grid gap-4 text-[13px]">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
            <dt className="text-muted">WhatsApp ID</dt><dd><code className="text-xs">{d.wa_id}</code></dd>
            <dt className="text-muted">Saved name</dt><dd>{d.display_name ?? '—'}</dd>
            <dt className="text-muted">Profile name</dt><dd>{d.profile_name ?? '—'}</dd>
            <dt className="text-muted">Type</dt><dd>{d.is_business ? 'WhatsApp Business' : 'Personal'}{d.is_my_contact ? ' · saved contact' : ''}</dd>
            <dt className="text-muted">Last interaction</dt><dd>{fmtDateTime(d.last_interaction_at)}</dd>
            <dt className="text-muted">Conversation</dt><dd>{d.chat ? <Link className="text-primary underline" to={`/inbox/${d.account_id}/${d.chat.id}`}>Open conversation</Link> : 'None synchronised'}</dd>
          </dl>
          <div className="grid gap-1.5">
            <p className="font-medium">Tags</p>
            <div className="flex gap-2">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} disabled={!editable} placeholder="customer, vip, invoice-due" />
              {editable && <Button variant="outline" onClick={async () => {
                try {
                  await api.put(`/accounts/${d.account_id}/contacts/${d.id}/tags`, { tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
                  toast.success('Tags saved');
                  refresh();
                } catch (e) { toastError(e); }
              }}>Save</Button>}
            </div>
          </div>
          <div className="grid gap-1.5">
            <p className="font-medium">Notes</p>
            {editable && (
              <div className="grid gap-2">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add an internal note (not sent to the contact)" />
                <div className="flex justify-end"><Button size="sm" disabled={!note.trim()} onClick={async () => {
                  try { await api.post(`/accounts/${d.account_id}/contacts/${d.id}/notes`, { body: note }); setNote(''); refresh(); } catch (e) { toastError(e); }
                }}>Add note</Button></div>
              </div>
            )}
            <ul className="divide-y rounded-md border">
              {(d.notes ?? []).length === 0 && <li className="p-3 text-muted">No notes.</li>}
              {(d.notes ?? []).map((n) => (
                <li key={n.id} className="flex gap-2 p-3">
                  <p className="flex-1 whitespace-pre-wrap">{n.body}</p>
                  <span className="text-xs text-muted">{timeAgo(n.created_at)}</span>
                  {editable && <button aria-label="Delete note" className="text-muted hover:text-danger cursor-pointer" onClick={async () => { await api.del(`/accounts/${d.account_id}/contacts/${d.id}/notes/${n.id}`); refresh(); }}><Trash2 className="size-4" /></button>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Contacts() {
  const accName = useAccountName();
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Contact | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setOffset(0); }, 300); return () => clearTimeout(t); }, [search]);
  const limit = 50;
  const res = useQuery({ queryKey: ['contacts', accountId, q, offset], queryFn: () => api.page<Contact>(`/contacts${qs({ account_id: accountId, q, limit, offset })}`) });
  const items = res.data?.data ?? [];
  return (
    <Page>
      <PageHeader title="Contacts" description="Contacts are kept separately for each WhatsApp account and are never merged." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <AccountSelect value={accountId} onChange={(v) => { setAccountId(v); setOffset(0); }} />
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, number or tag" className="pl-8" aria-label="Search contacts" />
          </div>
        </div>
        {res.isLoading && <div className="p-6"><Spinner /></div>}
        {!res.isLoading && !items.length && <EmptyState title="No contacts found" description="Contacts are synchronised from WhatsApp after an account connects." />}
        {items.length > 0 && (
          <Table>
            <THead><TR><TH>Name</TH><TH>Telephone</TH><TH className="hidden md:table-cell">Account</TH><TH className="hidden lg:table-cell">Tags</TH><TH className="hidden sm:table-cell">Last interaction</TH></TR></THead>
            <TBody>
              {items.map((c) => (
                <TR key={c.id} className="cursor-pointer" onClick={() => setOpen(c)}>
                  <TD><div className="flex items-center gap-2.5"><Avatar src={c.profile_pic_url} name={c.name} className="size-7" /><div><p className="font-medium">{c.name}</p>{c.profile_name && c.profile_name !== c.name && <p className="text-xs text-muted">~{c.profile_name}</p>}</div>{c.is_business && <Badge tone="info">Business</Badge>}</div></TD>
                  <TD className="tabular-nums">{c.phone_number ?? '—'}</TD>
                  <TD className="hidden text-muted md:table-cell">{accName(c.account_id)}</TD>
                  <TD className="hidden lg:table-cell"><div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}><Tag className="size-3" />{t}</Badge>)}</div></TD>
                  <TD className="hidden text-muted sm:table-cell">{c.last_interaction_at ? timeAgo(c.last_interaction_at) : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pager total={res.data?.meta?.pagination?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} />
      </Card>
      {open && <ContactDetail c={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}
