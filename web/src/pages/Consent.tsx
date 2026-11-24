import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Checkbox, Spinner } from '@/components/ui/misc';
import { AuthLayout } from './AuthLayout';

interface ConsentData {
  client: { client_id: string; name: string; client_uri: string | null; redirect_host: string };
  requested_scopes: { scope: string; description: string; grantable: boolean }[];
  accounts: { id: string; display_name: string; phone_number: string | null; status: string }[];
  approval_policies: string[];
  default_policy: string;
}

const POLICY_LABEL: Record<string, string> = {
  CONFIRM_IN_CHAT: 'Confirm in ChatGPT — you confirm each message in the chat before it is sent',
  CONFIRM_IN_CHAT_OR_DASHBOARD: 'Confirm in ChatGPT or approve in the dashboard',
  REQUIRE_APPROVAL: 'Dashboard approval — a reviewer approves each message in Chinwag',
  READ_ONLY: 'Read-only — cannot send anything',
  DIRECT: 'Direct sending — messages are sent immediately',
};

export function ConsentPage() {
  const { me, loading } = useAuth();
  const [params] = useSearchParams();
  const id = params.get('request') ?? '';
  const q = useQuery({ queryKey: ['consent', id], queryFn: () => api.get<ConsentData>(`/oauth/requests/${encodeURIComponent(id)}`), enabled: !!me && !!id, retry: false });
  const [scopes, setScopes] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [policy, setPolicy] = useState('REQUIRE_APPROVAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) {
      setScopes(q.data.requested_scopes.filter((s) => s.grantable).map((s) => s.scope));
      setPolicy(q.data.default_policy);
    }
  }, [q.data]);

  if (loading) return null;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(`/oauth/consent?request=${id}`)}`} replace />;

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ redirect_url: string }>(`/oauth/requests/${encodeURIComponent(id)}/decision`, { approve, scopes, account_ids: accounts, approval_policy: policy });
      window.location.assign(r.redirect_url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
      setBusy(false);
    }
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <AuthLayout wide>
      <Card>
        <CardContent className="p-5">
          {q.isLoading && <Spinner />}
          {q.error && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
          {q.data && (
            <div className="grid gap-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 text-primary" />
                <div>
                  <h1 className="text-base font-semibold">Authorise {q.data.client.name}</h1>
                  <p className="mt-1 text-[13px] text-muted">
                    <strong className="text-foreground">{q.data.client.name}</strong> wants to access Chinwag on your behalf ({me.email}). After approval you will return to <code>{q.data.client.redirect_host}</code>.
                  </p>
                </div>
              </div>

              <fieldset className="grid gap-2">
                <legend className="mb-1 text-[13px] font-semibold">WhatsApp accounts</legend>
                {q.data.accounts.length === 0 && <p className="text-[13px] text-muted">You do not have access to any WhatsApp accounts.</p>}
                {q.data.accounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2.5 rounded-md border p-2.5 text-[13px]">
                    <Checkbox checked={accounts.includes(a.id)} onCheckedChange={() => setAccounts(toggle(accounts, a.id))} />
                    <span className="flex-1">{a.display_name} <span className="text-muted">{a.phone_number}</span></span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-[13px] font-semibold">Permissions</legend>
                {q.data.requested_scopes.map((s) => (
                  <label key={s.scope} className={`flex items-center gap-2.5 text-[13px] ${s.grantable ? '' : 'opacity-50'}`}>
                    <Checkbox disabled={!s.grantable} checked={scopes.includes(s.scope)} onCheckedChange={() => setScopes(toggle(scopes, s.scope))} />
                    <span>{s.description}</span>
                    <code className="ml-auto text-[11px] text-muted">{s.scope}</code>
                  </label>
                ))}
              </fieldset>

              <label className="grid gap-1.5">
                <span className="text-[13px] font-semibold">How should outgoing messages be confirmed?</span>
                <NativeSelect value={policy} onChange={(e) => setPolicy(e.target.value)}>
                  {q.data.approval_policies.map((p) => <option key={p} value={p}>{POLICY_LABEL[p]}</option>)}
                </NativeSelect>
                {policy.startsWith('CONFIRM_IN_CHAT') && <span className="text-xs text-muted">ChatGPT shows you the exact draft — account, recipient, number and text — and only sends after you say yes. Unconfirmed drafts expire after 15 minutes.</span>}
              </label>

              <p className="rounded-md bg-surface-2 p-3 text-xs text-muted">Messages and contacts are third-party content. You can revoke this connection at any time from MCP Integration.</p>
              {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={() => decide(false)}>Deny</Button>
                <Button disabled={busy || !accounts.length || !scopes.length} onClick={() => decide(true)}>Allow access</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
