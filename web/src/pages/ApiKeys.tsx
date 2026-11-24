import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, timeAgo } from '@/lib/utils';
import { ConfirmDialog, EmptyState, Page, PageHeader, SecretReveal, StatusBadge, toastError, useAccounts } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

const SCOPES = ['accounts:read', 'accounts:manage', 'chats:read', 'messages:read', 'messages:send', 'contacts:read', 'contacts:write', 'groups:read', 'media:read', 'media:send', 'schedule:read', 'schedule:write'];

function CreateKey({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const { data: accounts } = useAccounts();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['accounts:read', 'chats:read', 'messages:read']);
  const [accIds, setAccIds] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [policy, setPolicy] = useState('REQUIRE_APPROVAL');
  const [expires, setExpires] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const toggle = (l: string[], v: string) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader title={secret ? 'API key created' : 'Create API key'} description={secret ? undefined : 'Keys are stored hashed. The full key is shown only once.'} />
        {secret ? (
          <>
            <SecretReveal label="API key" value={secret} note="Copy it now and store it securely. Use it as: Authorization: Bearer <key>" />
            <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api.post<{ secret: string }>('/api-keys', { name, scopes, account_ids: all ? [] : accIds, all_accounts: all, approval_policy: policy, expires_at: expires ? new Date(expires).toISOString() : null });
              setSecret(r.secret);
              qc.invalidateQueries({ queryKey: ['api-keys'] });
            } catch (err) { toastError(err); }
          }}>
            <Field label="Name" htmlFor="kn"><Input id="kn" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} placeholder="CRM integration" /></Field>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-[13px] font-medium">Permissions</legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {SCOPES.map((s) => <label key={s} className="flex items-center gap-2 text-xs"><Checkbox checked={scopes.includes(s)} onCheckedChange={() => setScopes(toggle(scopes, s))} /><code>{s}</code></label>)}
              </div>
            </fieldset>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-[13px] font-medium">WhatsApp accounts</legend>
              {me?.is_super_admin && <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={all} onCheckedChange={(v) => setAll(!!v)} /> All accounts (including future ones)</label>}
              {!all && (accounts ?? []).map((a) => <label key={a.id} className="flex items-center gap-2 text-[13px]"><Checkbox checked={accIds.includes(a.id)} onCheckedChange={() => setAccIds(toggle(accIds, a.id))} /> {a.display_name} <span className="text-muted">{a.phone_number}</span></label>)}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Outbound policy" htmlFor="kp">
                <NativeSelect id="kp" value={policy} onChange={(e) => setPolicy(e.target.value)}>
                  <option value="REQUIRE_APPROVAL">Require approval</option><option value="READ_ONLY">Read-only</option><option value="DIRECT">Direct sending</option>
                </NativeSelect>
              </Field>
              <Field label="Expires (optional)" htmlFor="ke"><Input id="ke" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
            </div>
            <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!name || !scopes.length || (!all && !accIds.length)}>Create key</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ApiKeys() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<any[]>('/api-keys') });
  const { data: accounts } = useAccounts();
  const [creating, setCreating] = useState(false);
  const [revoke, setRevoke] = useState<any>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const name = (id: string) => accounts?.find((a) => a.id === id)?.display_name ?? id;
  return (
    <Page>
      <PageHeader title="API Credentials" description={<>Scoped keys for the REST API at <code>/api/v1</code>. See the <a className="text-primary underline" href="/api/docs" target="_blank" rel="noreferrer">API documentation</a>.</>} actions={<Button onClick={() => setCreating(true)}><Plus /> Create key</Button>} />
      {rotated && <div className="mb-4"><SecretReveal label="Rotated key — the previous key has been revoked" value={rotated} note="Copy it now; it will not be shown again." /></div>}
      <Card>
        {q.data && !q.data.length && <EmptyState title="No API keys" />}
        {!!q.data?.length && (
          <Table>
            <THead><TR><TH>Name</TH><TH>Prefix</TH><TH className="hidden lg:table-cell">Permissions</TH><TH className="hidden md:table-cell">Accounts</TH><TH>Policy</TH><TH>Status</TH><TH className="hidden sm:table-cell">Last used</TH><TH /></TR></THead>
            <TBody>
              {q.data.map((k) => (
                <TR key={k.id}>
                  <TD className="font-medium">{k.name}<p className="text-[11px] font-normal text-muted">Created {fmtDateTime(k.created_at, { dateStyle: 'medium' })}{k.expires_at ? ` · expires ${fmtDateTime(k.expires_at, { dateStyle: 'medium' })}` : ''}</p></TD>
                  <TD><code className="text-xs">{k.prefix}…</code></TD>
                  <TD className="hidden lg:table-cell"><div className="flex max-w-72 flex-wrap gap-1">{k.scopes.map((s: string) => <Badge key={s}>{s}</Badge>)}</div></TD>
                  <TD className="hidden text-xs md:table-cell">{k.all_accounts ? 'All accounts' : k.account_ids.map(name).join(', ')}</TD>
                  <TD className="text-xs">{k.approval_policy.replace('_', ' ')}</TD>
                  <TD><StatusBadge status={k.status} /></TD>
                  <TD className="hidden text-xs text-muted sm:table-cell">{timeAgo(k.last_used_at)}</TD>
                  <TD className="whitespace-nowrap text-right">
                    {k.status === 'active' && <>
                      <Button size="sm" variant="ghost" onClick={async () => { try { const r = await api.post<{ secret: string }>(`/api-keys/${k.id}/rotate`); setRotated(r.secret); qc.invalidateQueries({ queryKey: ['api-keys'] }); } catch (e) { toastError(e); } }}>Rotate</Button>
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevoke(k)}>Revoke</Button>
                    </>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {creating && <CreateKey onClose={() => setCreating(false)} />}
      {revoke && <ConfirmDialog open onOpenChange={(o) => !o && setRevoke(null)} destructive title={`Revoke ${revoke.name}?`} description="Requests using this key are rejected immediately." confirmLabel="Revoke" onConfirm={async () => { await api.del(`/api-keys/${revoke.id}`); qc.invalidateQueries({ queryKey: ['api-keys'] }); }} />}
    </Page>
  );
}
