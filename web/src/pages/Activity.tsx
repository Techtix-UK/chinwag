import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/utils';
import { AccountSelect, EmptyState, Page, PageHeader, Pager, StatusBadge, useAccountName } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

export default function Activity() {
  const accName = useAccountName();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [result, setResult] = useState('');
  const [accountId, setAccountId] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setOffset(0); }, 300); return () => clearTimeout(t); }, [search]);
  const limit = 50;
  const res = useQuery({ queryKey: ['audit', q, source, result, accountId, offset], queryFn: () => api.page<any>(`/audit-logs${qs({ q, source, result, account_id: accountId, limit, offset })}`) });
  const rows = res.data?.data ?? [];
  return (
    <Page>
      <PageHeader title="Activity Logs" description="Significant actions. Tokens, passwords, session credentials, QR data and message contents are never logged." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input type="search" className="min-w-56 flex-1" placeholder="Search action, actor or IP" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search activity" />
          <NativeSelect className="w-auto" value={source} onChange={(e) => { setSource(e.target.value); setOffset(0); }} aria-label="Source">
            <option value="">All sources</option>{['dashboard', 'api', 'mcp', 'oauth', 'system', 'scheduler', 'webhook', 'setup'].map((s) => <option key={s}>{s}</option>)}
          </NativeSelect>
          <NativeSelect className="w-auto" value={result} onChange={(e) => { setResult(e.target.value); setOffset(0); }} aria-label="Result">
            <option value="">All results</option>{['success', 'failure', 'denied', 'pending'].map((s) => <option key={s}>{s}</option>)}
          </NativeSelect>
          <AccountSelect value={accountId} onChange={(v) => { setAccountId(v); setOffset(0); }} />
        </div>
        {res.isLoading && <div className="p-6"><Spinner /></div>}
        {!res.isLoading && !rows.length && <EmptyState title="No matching activity" />}
        {rows.length > 0 && (
          <Table>
            <THead><TR><TH>Time</TH><TH>Action</TH><TH>Actor</TH><TH className="hidden md:table-cell">Source</TH><TH className="hidden md:table-cell">Account</TH><TH>Result</TH><TH className="hidden xl:table-cell">Details</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-xs">{fmtDateTime(r.timestamp, { dateStyle: 'short', timeStyle: 'medium' })}</TD>
                  <TD><code className="text-xs">{r.action}</code></TD>
                  <TD className="max-w-56 truncate text-xs" title={r.actor.label ?? ''}>{r.actor.label ?? r.actor.type}{r.ip_address && <p className="text-muted">{r.ip_address}</p>}</TD>
                  <TD className="hidden text-xs md:table-cell">{r.source}</TD>
                  <TD className="hidden text-xs md:table-cell">{r.account_id ? accName(r.account_id) : '—'}</TD>
                  <TD><StatusBadge status={r.result} /></TD>
                  <TD className="hidden max-w-80 xl:table-cell"><code className="line-clamp-2 break-all text-[11px] text-muted">{r.metadata ? JSON.stringify(r.metadata) : ''}</code></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pager total={res.data?.meta?.pagination?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} />
      </Card>
    </Page>
  );
}
