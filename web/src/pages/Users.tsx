import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { TIMEZONES, timeAgo } from '@/lib/utils';
import { ConfirmDialog, Page, PageHeader, StatusBadge, toastError, useAccounts } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

interface U { id: string; email: string; name: string; timezone: string | null; is_active: boolean; locked_until: string | null; last_login_at: string | null; roles: string[]; account_permissions: { account_id: string; level: string }[] }

function Editor({ user, roles, onClose }: { user: U | null; roles: { key: string; name: string; description: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const { data: accounts } = useAccounts();
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', password: '', role: user?.roles[0] ?? 'agent', is_active: user?.is_active ?? true, timezone: user?.timezone ?? '' });
  const [access, setAccess] = useState<Record<string, string>>(Object.fromEntries((user?.account_permissions ?? []).map((a) => [a.account_id, a.level])));
  const selectable = roles.filter((r) => me?.is_super_admin || r.key !== 'super_admin');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader title={user ? `Edit ${user.name}` : 'Invite user'} description="Permissions are enforced by the server for every request." />
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault();
          const account_access = Object.entries(access).filter(([, l]) => l).map(([account_id, level]) => ({ account_id, level }));
          try {
            if (user) await api.patch(`/users/${user.id}`, { name: f.name, roles: [f.role], is_active: f.is_active, account_access, timezone: f.timezone || null, ...(f.password ? { password: f.password } : {}) });
            else await api.post('/users', { name: f.name, email: f.email, password: f.password, roles: [f.role], account_access, timezone: f.timezone || null });
            qc.invalidateQueries({ queryKey: ['users'] });
            onClose();
          } catch (err) { toastError(err); }
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="un"><Input id="un" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Email" htmlFor="ue"><Input id="ue" type="email" required disabled={!!user} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label={user ? 'New password (optional)' : 'Initial password'} htmlFor="up" hint="12+ characters; share it securely and ask the user to change it."><Input id="up" type="password" autoComplete="new-password" required={!user} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <Field label="Timezone" htmlFor="utz"><NativeSelect id="utz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}><option value="">Application default</option>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</NativeSelect></Field>
          </div>
          <Field label="Role" htmlFor="ur" hint={roles.find((r) => r.key === f.role)?.description}>
            <NativeSelect id="ur" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{selectable.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</NativeSelect>
          </Field>
          {f.role !== 'super_admin' && (
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">Account access</legend>
              <div className="divide-y rounded-md border">
                {(accounts ?? []).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <span className="flex-1">{a.display_name} <span className="text-muted">{a.phone_number}</span></span>
                    <NativeSelect className="h-8 w-36 text-xs" value={access[a.id] ?? ''} onChange={(e) => setAccess({ ...access, [a.id]: e.target.value })} aria-label={`Access to ${a.display_name}`}>
                      <option value="">No access</option><option value="read">Read</option><option value="send">Read &amp; send</option><option value="manage">Manage</option>
                    </NativeSelect>
                  </div>
                ))}
              </div>
            </fieldset>
          )}
          {user && <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} /> Active (deactivating signs the user out everywhere)</label>}
          <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">{user ? 'Save' : 'Create user'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<U[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ roles: { key: string; name: string; description: string; permissions: string[] }[]; permissions: { key: string; description: string }[] }>('/roles') });
  const { data: accounts } = useAccounts();
  const [edit, setEdit] = useState<U | null | 'new'>(null);
  const [del, setDel] = useState<U | null>(null);
  const roleName = (k: string) => roles.data?.roles.find((r) => r.key === k)?.name ?? k;
  return (
    <Page>
      <PageHeader title="Users & Permissions" actions={<Button onClick={() => setEdit('new')}><Plus /> Add user</Button>} />
      <Card>
        <Table>
          <THead><TR><TH>User</TH><TH>Role</TH><TH className="hidden md:table-cell">Accounts</TH><TH>Status</TH><TH className="hidden sm:table-cell">Last sign-in</TH><TH /></TR></THead>
          <TBody>
            {users.data?.map((u) => (
              <TR key={u.id}>
                <TD><p className="font-medium">{u.name}{u.id === me?.id && <span className="ml-1 text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{u.email}</p></TD>
                <TD>{u.roles.map((r) => <Badge key={r}>{roleName(r)}</Badge>)}</TD>
                <TD className="hidden text-xs md:table-cell">{u.roles.includes('super_admin') ? 'All' : u.account_permissions.map((a) => `${accounts?.find((x) => x.id === a.account_id)?.display_name ?? '?'} (${a.level})`).join(', ') || 'None'}</TD>
                <TD>{u.locked_until && new Date(u.locked_until) > new Date() ? <StatusBadge status="denied" /> : <StatusBadge status={u.is_active ? 'active' : 'revoked'} />}</TD>
                <TD className="hidden text-xs text-muted sm:table-cell">{timeAgo(u.last_login_at)}</TD>
                <TD className="whitespace-nowrap text-right">
                  {u.locked_until && new Date(u.locked_until) > new Date() && <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/users/${u.id}/unlock`); qc.invalidateQueries({ queryKey: ['users'] }); }}>Unlock</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setEdit(u)}>Edit</Button>
                  {u.id !== me?.id && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDel(u)}>Delete</Button>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card className="mt-4">
        <CardHeader><CardTitle>Roles</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {roles.data?.roles.map((r) => (
            <div key={r.key} className="rounded-md border p-3">
              <p className="text-[13px] font-semibold">{r.name}</p>
              <p className="mt-0.5 text-xs text-muted">{r.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">{r.permissions.map((p) => <Badge key={p} className="font-mono">{p}</Badge>)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      {edit && roles.data && <Editor user={edit === 'new' ? null : edit} roles={roles.data.roles} onClose={() => setEdit(null)} />}
      {del && <ConfirmDialog open onOpenChange={(o) => !o && setDel(null)} destructive title={`Delete ${del.name}?`} description="Their sessions and MCP authorisations are removed." confirmLabel="Delete user" onConfirm={async () => { await api.del(`/users/${del.id}`); qc.invalidateQueries({ queryKey: ['users'] }); }} />}
    </Page>
  );
}
