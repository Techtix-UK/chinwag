import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, MoreHorizontal, Plus, QrCode } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Account } from '@/lib/types';
import { resetSocket, useSocketEvent } from '@/lib/socket';
import { fmtBytes, fmtDateTime, timeAgo } from '@/lib/utils';
import { ConfirmDialog, EmptyState, Page, PageHeader, StatusBadge, toastError, useAccounts } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown';
import { Field, Input } from '@/components/ui/input';
import { Avatar, Spinner } from '@/components/ui/misc';

function QrPanel({ account }: { account: Account }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['qr', account.id], queryFn: () => api.get<{ data_url: string | null; updated_at?: string }>(`/accounts/${account.id}/qr`), refetchInterval: 20_000 });
  useSocketEvent<{ account_id: string; data_url: string | null; updated_at?: string }>('account.qr', (e) => {
    if (e.account_id === account.id) qc.setQueryData(['qr', account.id], { data_url: e.data_url, updated_at: e.updated_at });
  }, [account.id]);
  const url = q.data?.data_url;
  return (
    <div className="grid justify-items-center gap-3 text-center">
      <div className="flex size-64 items-center justify-center rounded-lg border bg-white p-2">
        {url ? <img src={url} alt="WhatsApp pairing QR code" className="size-full" /> : <Spinner className="text-zinc-400" />}
      </div>
      <ol className="max-w-xs text-left text-[13px] text-muted list-decimal pl-5 space-y-0.5">
        <li>Open WhatsApp on the phone for <strong className="text-foreground">{account.display_name}</strong>.</li>
        <li>Go to <strong className="text-foreground">Settings → Linked devices → Link a device</strong>.</li>
        <li>Scan this code. It refreshes automatically.</li>
      </ol>
      {q.data?.updated_at && <p className="text-[11px] text-muted">Updated {timeAgo(q.data.updated_at)}</p>}
    </div>
  );
}

function PairDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const { data } = useAccounts();
  const live = data?.find((a) => a.id === account.id) ?? account;
  const done = live.status === 'connected' || live.status === 'synchronising';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title={`Link ${live.display_name}`} description={<span className="inline-flex items-center gap-2">Status: <StatusBadge status={live.status} /></span>} />
        {done ? (
          <div className="grid gap-2 py-6 text-center">
            <p className="text-sm font-medium">Linked successfully</p>
            <p className="text-[13px] text-muted">{live.phone_number} · Recent conversations are being synchronised.</p>
          </div>
        ) : ['awaiting_qr', 'initialising', 'authenticating', 'reconnecting'].includes(live.status) ? (
          live.status === 'authenticating' ? <div className="py-8 text-center text-[13px] text-muted"><Spinner /> <p className="mt-2">{live.status_detail ?? 'Authenticating…'}</p></div> : <QrPanel account={live} />
        ) : (
          <p className="text-[13px] text-muted">{live.status_detail ?? 'The session is not running.'}</p>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>{done ? 'Done' : 'Close'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Diagnostics({ account, onClose }: { account: Account; onClose: () => void }) {
  const q = useQuery({ queryKey: ['diag', account.id], queryFn: () => api.get<any>(`/accounts/${account.id}/diagnostics`), refetchInterval: 10_000 });
  const d = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader title={`Diagnostics · ${account.display_name}`} description="Session state, stored data and resource usage." />
        {!d ? <Spinner /> : (
          <div className="grid gap-4 text-[13px]">
            <dl className="grid grid-cols-[11rem_1fr] gap-y-1">
              <dt className="text-muted">Status</dt><dd><StatusBadge status={d.account.status} /> <span className="text-muted">{d.account.status_detail}</span></dd>
              <dt className="text-muted">Client ID</dt><dd><code>{d.session.client_id}</code></dd>
              <dt className="text-muted">Auth directory</dt><dd className="break-all"><code>{d.session.auth_directory}</code></dd>
              <dt className="text-muted">WhatsApp Web version</dt><dd>{d.session.wweb_version ?? '—'}</dd>
              <dt className="text-muted">Last ready</dt><dd>{fmtDateTime(d.session.last_ready_at)}</dd>
              <dt className="text-muted">Recovery attempts</dt><dd>{d.session.reconnect_attempts}</dd>
              <dt className="text-muted">Last error</dt><dd className="break-all">{d.session.last_error ?? '—'}</dd>
              <dt className="text-muted">Chromium</dt><dd>{d.resources.pid ? `PID ${d.resources.pid} · ${d.resources.processes} processes · ${d.resources.memory_mb} MB · ${d.resources.cpu_percent}% CPU` : 'Not running'}</dd>
              <dt className="text-muted">Stored data</dt><dd>{d.data.chats} chats · {d.data.messages} messages · {d.data.contacts} contacts · {d.data.media_files} media ({fmtBytes(d.data.media_bytes)})</dd>
            </dl>
            {d.events.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Recent events</p>
                <ul className="max-h-48 divide-y overflow-y-auto rounded border text-xs">
                  {d.events.map((e: any, i: number) => <li key={i} className="flex gap-2 px-2 py-1.5"><span className="text-muted">{fmtDateTime(e.timestamp)}</span><span className={e.level === 'error' ? 'text-danger' : ''}>{e.message}</span></li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Accounts() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useAccounts();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [pair, setPair] = useState<Account | null>(null);
  const [diag, setDiag] = useState<Account | null>(null);
  const [rename, setRename] = useState<Account | null>(null);
  const [confirm, setConfirm] = useState<{ account: Account; action: 'logout' | 'remove' | 'disconnect' } | null>(null);
  useSocketEvent('account.status', () => qc.invalidateQueries({ queryKey: ['accounts'] }));
  const refresh = () => qc.invalidateQueries({ queryKey: ['accounts'] });

  const act = async (a: Account, action: string) => {
    try {
      await api.post(`/accounts/${a.id}/${action}`);
      toast.success(`${a.display_name}: ${action} requested`);
      refresh();
      if (action === 'connect' || action === 'reauthenticate') setPair(a);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Page>
      <PageHeader
        title="WhatsApp Accounts"
        description="Each account is an independent WhatsApp Web linked-device session with its own isolated storage."
        actions={can('accounts:manage') && <Button onClick={() => setAdding(true)}><Plus /> Add account</Button>}
      />
      <div className="mb-4 flex gap-2.5 rounded-md border border-warning/40 bg-warning/5 p-3 text-[13px]">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <p>
          Accounts connect through <strong>whatsapp-web.js</strong>, an unofficial library that automates WhatsApp Web. It is not endorsed by WhatsApp or Meta, may break when WhatsApp Web changes, and WhatsApp may restrict accounts used for automation. Only send messages that recipients expect.
        </p>
      </div>
      <Card>
        {isLoading && <div className="p-6"><Spinner /></div>}
        {data && !data.length && <EmptyState icon={QrCode} title="No WhatsApp accounts yet" description="Add an account, then scan the QR code from WhatsApp → Linked devices." action={can('accounts:manage') && <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add account</Button>} />}
        <ul className="divide-y">
          {data?.map((a) => {
            const manage = can('accounts:manage', a.id, 'manage');
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar src={a.profile_pic_url} name={a.display_name} />
                <div className="min-w-48 flex-1">
                  <p className="font-medium">{a.display_name}</p>
                  <p className="text-xs text-muted">{a.phone_number ?? 'Not linked'}{a.profile_name ? ` · ${a.profile_name}` : ''}</p>
                </div>
                <div className="min-w-48 text-xs text-muted">
                  <StatusBadge status={a.status} />
                  <p className="mt-1 max-w-72 truncate" title={a.status_detail ?? ''}>{a.status_detail ?? (a.last_connected_at ? `Last connected ${timeAgo(a.last_connected_at)}` : `Added ${fmtDateTime(a.created_at, { dateStyle: 'medium' })}`)}</p>
                </div>
                {manage && (
                  <div className="flex items-center gap-1.5">
                    {a.status === 'awaiting_qr' && <Button size="sm" onClick={() => setPair(a)}><QrCode /> Show QR</Button>}
                    {['disconnected', 'error', 'session_expired', 'auth_failed', 'logged_out'].includes(a.status) && <Button size="sm" variant="outline" onClick={() => act(a, a.status === 'logged_out' || a.status === 'auth_failed' ? 'reauthenticate' : 'connect')}>Connect</Button>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Actions for ${a.display_name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => { setRename(a); setName(a.display_name); }}>Rename</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDiag(a)}>Diagnostics</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => act(a, 'connect')}>Connect</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => act(a, 'restart')}>Restart session</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setConfirm({ account: a, action: 'disconnect' })}>Disconnect</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => act(a, 'reauthenticate')}>Re-authenticate (new QR)</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => setConfirm({ account: a, action: 'logout' })}>Log out device</DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => setConfirm({ account: a, action: 'remove' })}>Remove account</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader title="Add WhatsApp account" description="A new isolated WhatsApp Web session starts and shows a QR code to scan." />
          <form className="grid gap-4" onSubmit={async (e) => {
            e.preventDefault();
            try {
              const a = await api.post<Account>('/accounts', { display_name: name, connect: true });
              setAdding(false);
              setName('');
              resetSocket();
              await refresh();
              setPair(a);
            } catch (err) {
              toastError(err);
            }
          }}>
            <Field label="Display name" htmlFor="dn" hint="For example: Sales UK"><Input id="dn" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
            <DialogFooter><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" disabled={!name.trim()}>Create and pair</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rename} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent>
          <DialogHeader title="Rename account" />
          <form className="grid gap-4" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.patch(`/accounts/${rename!.id}`, { display_name: name });
              setRename(null);
              refresh();
            } catch (err) {
              toastError(err);
            }
          }}>
            <Field label="Display name" htmlFor="rn"><Input id="rn" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <DialogFooter><Button type="submit">Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {pair && <PairDialog account={pair} onClose={() => setPair(null)} />}
      {diag && <Diagnostics account={diag} onClose={() => setDiag(null)} />}
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          destructive={confirm.action !== 'disconnect'}
          title={confirm.action === 'remove' ? `Remove ${confirm.account.display_name}?` : confirm.action === 'logout' ? `Log out ${confirm.account.display_name}?` : `Disconnect ${confirm.account.display_name}?`}
          description={
            confirm.action === 'remove'
              ? 'The session is logged out locally and all stored conversations, contacts, media and scheduled messages for this account are permanently deleted.'
              : confirm.action === 'logout'
                ? 'The linked device is removed from WhatsApp and the stored session is deleted. Reconnecting requires a new QR scan.'
                : 'The session stops but stays linked. It will not reconnect automatically until you connect it again.'
          }
          confirmLabel={confirm.action === 'remove' ? 'Remove permanently' : confirm.action === 'logout' ? 'Log out' : 'Disconnect'}
          onConfirm={async () => {
            if (confirm.action === 'remove') await api.del(`/accounts/${confirm.account.id}`);
            else await api.post(`/accounts/${confirm.account.id}/${confirm.action}`);
            refresh();
          }}
        />
      )}
    </Page>
  );
}
