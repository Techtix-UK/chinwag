import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { TIMEZONES } from '@/lib/utils';
import { Page, PageHeader, toastError } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Spinner, Switch } from '@/components/ui/misc';

type S = Record<string, any>;

const NUM = (label: string, key: string, hint?: string, min = 0, max = 100000) => ({ label, key, hint, min, max, type: 'number' as const });

const SECTIONS: { title: string; description?: string; fields: any[] }[] = [
  { title: 'General', fields: [{ label: 'Application name', key: 'appName', type: 'text' }, { label: 'Logo URL', key: 'logoUrl', type: 'text', hint: 'HTTPS URL or local path. Leave empty for the default mark.' }, { label: 'Base URL', key: 'baseUrl', type: 'text', hint: 'Displayed in links. OAuth/MCP use BASE_URL from the environment.' }, { label: 'Default timezone', key: 'defaultTimezone', type: 'tz' }, { label: 'Default language', key: 'defaultLanguage', type: 'select', options: [['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['en-ZA', 'English (South Africa)']] }] },
  { title: 'Sessions & sign-in', fields: [NUM('Session lifetime (hours)', 'sessionExpiryHours', undefined, 1, 720), NUM('Idle timeout (minutes)', 'sessionIdleMinutes', undefined, 5, 10080), NUM('Failed sign-ins before lockout', 'loginMaxAttempts', undefined, 3, 50), NUM('Lockout duration (minutes)', 'loginLockoutMinutes', undefined, 1, 1440), NUM('Minimum password length', 'passwordMinLength', undefined, 10, 128)] },
  { title: 'WhatsApp', fields: [NUM('Maximum connected accounts', 'maxConnectedAccounts', 'Each account runs its own Chromium (~250–400 MB RAM).', 1, 200), NUM('Initial sync — chats', 'initialSyncChats', 'Most recent chats whose messages are loaded on connection.', 0, 1000), NUM('Initial sync — messages per chat', 'initialSyncMessagesPerChat', undefined, 0, 1000), { label: 'Download media automatically', key: 'autoDownloadMedia', type: 'bool', hint: 'Incoming media is stored locally. When off, media is fetched on demand.' }, NUM('Automatic reconnect attempts', 'connectionRetryLimit', 'After this many failed recoveries the session stops until restarted manually.', 0, 50)] },
  { title: 'Messaging & storage', fields: [NUM('Maximum attachment size (MB)', 'maxAttachmentMb', undefined, 1, 100), NUM('Scheduled message expiry (minutes)', 'scheduledExpiryMinutes', 'If the account is disconnected for longer than this after the due time, the message expires instead of sending late.', 1, 10080), NUM('Message retention (days, 0 = keep)', 'messageRetentionDays'), NUM('Media retention (days, 0 = keep)', 'mediaRetentionDays'), NUM('Activity log retention (days, 0 = keep)', 'auditRetentionDays')] },
  { title: 'Integrations', fields: [{ label: 'Default approval policy', key: 'defaultApprovalPolicy', type: 'select', options: [['REQUIRE_APPROVAL', 'Require approval before sending'], ['READ_ONLY', 'Read-only'], ['DIRECT', 'Direct sending']] }, NUM('API rate limit (requests/minute per key)', 'apiRateLimitPerMinute', undefined, 1, 10000), { label: 'Allow dynamic OAuth client registration', key: 'allowDynamicClientRegistration', type: 'bool', hint: 'Required for ChatGPT to register. Every connection still requires consent.' }] },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<S>('/settings') });
  const [s, setS] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  if (!s) return <Page><Spinner /></Page>;
  const dirty = JSON.stringify(s) !== JSON.stringify(q.data);
  const save = async () => {
    setBusy(true);
    try {
      const patch: S = {};
      for (const k of Object.keys(s)) if (k !== 'setupCompleted' && s[k] !== q.data![k]) patch[k] = s[k] === '' && k === 'logoUrl' ? null : s[k];
      await api.patch('/settings', patch);
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Page className="max-w-4xl">
      <PageHeader title="Settings" description="Sensitive deployment values (database, encryption key, Chromium path) are configured in the environment file, not here." actions={<Button disabled={!dirty || busy} onClick={save}>Save changes</Button>} />
      <div className="grid gap-4">
        {SECTIONS.map((sec) => (
          <Card key={sec.title}>
            <CardHeader><div><CardTitle>{sec.title}</CardTitle>{sec.description && <CardDescription>{sec.description}</CardDescription>}</div></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {sec.fields.map((f) => f.type === 'bool' ? (
                <label key={f.key} className="flex items-start justify-between gap-3 rounded-md border p-3 sm:col-span-2">
                  <span><span className="block text-[13px] font-medium">{f.label}</span>{f.hint && <span className="block text-xs text-muted">{f.hint}</span>}</span>
                  <Switch checked={!!s[f.key]} onCheckedChange={(v) => setS({ ...s, [f.key]: v })} />
                </label>
              ) : (
                <Field key={f.key} label={f.label} hint={f.hint} htmlFor={f.key}>
                  {f.type === 'number' ? <Input id={f.key} type="number" min={f.min} max={f.max} value={s[f.key]} onChange={(e) => setS({ ...s, [f.key]: Number(e.target.value) })} />
                    : f.type === 'tz' ? <NativeSelect id={f.key} value={s[f.key]} onChange={(e) => setS({ ...s, [f.key]: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</NativeSelect>
                    : f.type === 'select' ? <NativeSelect id={f.key} value={s[f.key]} onChange={(e) => setS({ ...s, [f.key]: e.target.value })}>{f.options.map(([v, l]: string[]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
                    : <Input id={f.key} value={s[f.key] ?? ''} onChange={(e) => setS({ ...s, [f.key]: e.target.value })} />}
                </Field>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </Page>
  );
}
