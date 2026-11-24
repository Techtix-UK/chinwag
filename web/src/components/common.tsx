import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Inbox as InboxIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Account } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from './ui/dialog';
import { NativeSelect } from './ui/input';

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-7xl p-4 md:p-6', className)}>{children}</div>;
}

export function EmptyState({ title, description, icon: Icon = InboxIcon, action }: { title: string; description?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Icon className="size-6 text-muted" />
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-[13px] text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  connected: 'success', synchronising: 'info', initialising: 'info', authenticating: 'info', awaiting_qr: 'warning', reconnecting: 'warning',
  disconnected: 'neutral', logged_out: 'neutral', auth_failed: 'danger', session_expired: 'warning', error: 'danger',
  pending: 'warning', awaiting_approval: 'warning', processing: 'info', sent: 'success', delivered: 'success', read: 'success', played: 'success',
  failed: 'danger', cancelled: 'neutral', expired: 'neutral', delivery_uncertain: 'danger', approved: 'success', rejected: 'neutral',
  executed: 'success', superseded: 'neutral', active: 'success', revoked: 'neutral', succeeded: 'success', retrying: 'warning', delivering: 'info',
  success: 'success', failure: 'danger', denied: 'warning', ok: 'success', degraded: 'danger',
};
const LABEL: Record<string, string> = { ok: 'Healthy', degraded: 'Degraded', awaiting_qr: 'Awaiting QR scan', auth_failed: 'Authentication failed', session_expired: 'Session expired', logged_out: 'Logged out', delivery_uncertain: 'Delivery uncertain', awaiting_approval: 'Awaiting approval' };

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  const label = LABEL[status] ?? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Badge tone={tone} className={className}>
      <span className={cn('size-1.5 rounded-full bg-current', (status === 'synchronising' || status === 'reconnecting' || status === 'initialising' || status === 'authenticating') && 'animate-pulse')} aria-hidden />
      {label}
    </Badge>
  );
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const pageNo = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-[13px] text-muted">
      <span>
        {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString('en-GB')}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span>
          {pageNo} / {pages}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/accounts'), staleTime: 15_000 });
}

export function AccountSelect({ value, onChange, allowAll = true, className, filter }: { value: string; onChange: (v: string) => void; allowAll?: boolean; className?: string; filter?: (a: Account) => boolean }) {
  const { data } = useAccounts();
  const list = (data ?? []).filter(filter ?? (() => true));
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className={cn('w-auto min-w-44', className)} aria-label="WhatsApp account">
      {allowAll ? <option value="">All accounts</option> : <option value="" disabled>Select account…</option>}
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.display_name}
          {a.phone_number ? ` (${a.phone_number})` : ''}
        </option>
      ))}
    </NativeSelect>
  );
}

export function useAccountName() {
  const { data } = useAccounts();
  return (id: string | null | undefined) => data?.find((a) => a.id === id)?.display_name ?? (id ? 'Unknown account' : '—');
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: React.ReactNode; confirmLabel?: string; destructive?: boolean; onConfirm: () => Promise<unknown> | void }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={title} description={description} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function toastError(e: unknown) {
  const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong';
  toast.error(msg);
}

export function SecretReveal({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
      <p className="text-[13px] font-medium">{label}</p>
      <div className="flex gap-2">
        <code className="flex-1 break-all rounded bg-surface px-2 py-1.5 font-mono text-xs">{value}</code>
        <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success('Copied'))}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'danger' | 'warning' }) {
  return (
    <div className="rounded-lg border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning')}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
