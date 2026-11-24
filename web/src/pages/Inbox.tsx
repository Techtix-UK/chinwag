import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Popover } from 'radix-ui';
import { toast } from 'sonner';
import {
  Archive, ArrowLeft, Check, CheckCheck, Clock, CornerUpLeft, Download, FileText, History, MapPin, Paperclip, Pin, Search, Send, SmilePlus, Users, X, CalendarClock, AlertCircle, Smile,
} from 'lucide-react';
import { api, ApiError, idempotencyKey, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Attachment, Chat, Message } from '@/lib/types';
import { useSocketEvent } from '@/lib/socket';
import { chatTitle, cn, fmtBytes, fmtDay, fmtRelativeShort, fmtTime, sameDay, toLocalInput, displayTimezone } from '@/lib/utils';
import { AccountSelect, EmptyState, StatusBadge, toastError, useAccountName, useAccounts } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Avatar, Spinner, Tooltip } from '@/components/ui/misc';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'individuals', label: 'Individuals' },
  { id: 'groups', label: 'Groups' },
  { id: 'archived', label: 'Archived' },
] as const;

const EMOJI = '😀 😂 😊 😍 🙏 👍 👏 🙌 🎉 ❤️ 🔥 ✅ ❌ ⚠️ 📎 📄 📅 ⏰ 💬 📞 👋 🤝 💡 🚀 😢 😮 🤔 😅 👌 💯 ⭐ 📦 💳 🧾 🏠 🇬🇧 🇿🇦'.split(' ');
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

type MsgPage = { items: Message[]; has_more_local: boolean; next_before: string | null; sync_state: string; chat: Chat };

// ───────────────────────────── chat list ─────────────────────────────

function ChatList({ accountId, setAccountId, selected }: { accountId: string; setAccountId: (v: string) => void; selected?: string }) {
  const qc = useQueryClient();
  const accName = useAccountName();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const key = ['chats', accountId, filter, debounced];
  const q = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.page<Chat>(`/chats${qs({ account_id: accountId, filter, q: debounced, limit: 40, offset: pageParam })}`),
    getNextPageParam: (last, all) => (last.meta?.pagination?.has_more ? all.length * 40 : undefined),
  });
  useSocketEvent<{ chat: Chat }>('chat.upsert', () => qc.invalidateQueries({ queryKey: ['chats'] }));
  const chats = q.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="grid gap-2 border-b p-3">
        <AccountSelect value={accountId} onChange={setAccountId} className="w-full" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, number or message" className="pl-8" aria-label="Search conversations" />
        </div>
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter conversations">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={cn('rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap cursor-pointer', filter === f.id ? 'border-primary bg-primary text-primary-foreground' : 'text-muted hover:bg-surface-2')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isLoading && <div className="p-4"><Spinner /></div>}
        {!q.isLoading && !chats.length && <EmptyState title={debounced ? 'No matches' : 'No conversations'} description={debounced ? 'Search covers names, numbers and locally synchronised messages.' : 'Conversations appear once an account is connected and synchronised.'} />}
        <ul>
          {chats.map((c) => (
            <li key={c.id}>
              <Link to={`/inbox/${c.account_id}/${c.id}`} className={cn('flex gap-3 border-b px-3 py-2.5 hover:bg-surface-2/70', selected === c.id && 'bg-accent')}>
                <Avatar src={c.profile_pic_url} name={chatTitle(c)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="flex-1 truncate text-[13px] font-medium">
                      {c.is_group && <Users className="mr-1 inline size-3.5 text-muted" aria-label="Group" />}
                      {chatTitle(c)}
                    </p>
                    <span className={cn('shrink-0 text-[11px]', c.unread_count ? 'font-medium text-primary' : 'text-muted')}>{fmtRelativeShort(c.last_message_at)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <p className="flex-1 truncate text-xs text-muted">
                      {c.last_message_from_me && <span>You: </span>}
                      {c.last_message_preview ?? ''}
                    </p>
                    {c.pinned && <Pin className="size-3 text-muted" aria-label="Pinned" />}
                    {c.archived && <Archive className="size-3 text-muted" aria-label="Archived" />}
                    {c.unread_count > 0 && <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold text-primary-foreground">{c.unread_count}</span>}
                  </div>
                  {!accountId && <p className="mt-0.5 truncate text-[11px] text-muted">{accName(c.account_id)}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {q.hasNextPage && (
          <div className="p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Load more</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── message bubble ─────────────────────────────

function StatusIcon({ m }: { m: Message }) {
  if (!m.from_me) return null;
  if (m._error || m.status === 'failed') return <AlertCircle className="size-3.5 text-danger" aria-label="Failed" />;
  if (m._pending || m.status === 'pending' || m.status === 'sending') return <Clock className="size-3.5" aria-label="Sending" />;
  if (m.status === 'sent') return <Check className="size-3.5" aria-label="Sent" />;
  if (m.status === 'delivered') return <CheckCheck className="size-3.5" aria-label="Delivered" />;
  if (m.status === 'read' || m.status === 'played') return <CheckCheck className="size-3.5 text-sky-500" aria-label="Read" />;
  return null;
}

function MediaView({ att, type }: { att: Attachment; type: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (att.state !== 'stored') {
    return (
      <button
        className="flex w-56 items-center gap-2 rounded-md border bg-surface/60 px-2.5 py-2 text-left text-xs cursor-pointer disabled:opacity-60"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/media/${att.id}/fetch`);
            qc.invalidateQueries({ queryKey: ['messages'] });
          } catch (e) {
            toastError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : <Download className="size-4" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{att.filename ?? type}</span>
          <span className="text-muted">{att.state === 'failed' ? 'Download failed — retry' : 'Not downloaded — fetch from WhatsApp'} {att.size_bytes ? `· ${fmtBytes(att.size_bytes)}` : ''}</span>
        </span>
      </button>
    );
  }
  if (att.mime_type.startsWith('image/')) {
    return (
      <a href={att.url} target="_blank" rel="noreferrer">
        <img src={att.url} alt={att.filename ?? 'Image'} loading="lazy" className={cn('max-h-80 max-w-full rounded-md', type === 'sticker' && 'max-h-32 bg-transparent')} />
      </a>
    );
  }
  if (att.mime_type.startsWith('video/')) return <video src={att.url} controls preload="metadata" className="max-h-80 max-w-full rounded-md" />;
  if (att.mime_type.startsWith('audio/')) return <audio src={att.url} controls preload="metadata" className="w-64 max-w-full" />;
  return (
    <a href={`${att.url}?download=1`} className="flex w-60 items-center gap-2 rounded-md border bg-surface/60 px-2.5 py-2 text-xs hover:bg-surface">
      <FileText className="size-5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{att.filename ?? 'Document'}</span>
        <span className="text-muted">{att.mime_type} · {fmtBytes(att.size_bytes)}</span>
      </span>
      <Download className="size-4" />
    </a>
  );
}

function Bubble({ m, isGroup, onReply, onReact, canSend }: { m: Message; isGroup: boolean; onReply: (m: Message) => void; onReact: (m: Message, e: string) => void; canSend: boolean }) {
  const reactions = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of m.reactions) map.set(r.emoji, (map.get(r.emoji) ?? 0) + 1);
    return [...map.entries()];
  }, [m.reactions]);
  const system = ['notification', 'group_notification', 'e2e_notification', 'call_log', 'gp2'].includes(m.type);
  if (system) return <div className="my-2 text-center text-xs text-muted">{m.body ?? m.type}</div>;
  return (
    <div className={cn('group flex', m.from_me ? 'justify-end' : 'justify-start')}>
      <div className={cn('relative max-w-[min(34rem,85%)] rounded-lg px-2.5 pb-1.5 pt-1.5 shadow-sm', m.from_me ? 'bg-bubble-out' : 'border bg-bubble-in')}>
        {isGroup && !m.from_me && <p className="mb-0.5 text-xs font-semibold text-primary">{m.sender_name ?? m.sender_wa_id?.split('@')[0]}</p>}
        {m.forwarded && <p className="mb-0.5 text-[11px] italic text-muted">Forwarded</p>}
        {m.quoted && (
          <div className="mb-1 rounded border-l-2 border-primary bg-black/5 px-2 py-1 text-xs text-muted dark:bg-white/5">
            <p className="line-clamp-2">{m.quoted.body || 'Quoted message'}</p>
          </div>
        )}
        {m.attachments.map((a) => (
          <div key={a.id} className="mb-1">
            <MediaView att={a} type={m.type} />
          </div>
        ))}
        {m.has_media && !m.attachments.length && <p className="text-xs italic text-muted">Media ({m.type}) not available</p>}
        {m.location && (
          <a className="mb-1 flex items-center gap-1.5 text-[13px] text-primary underline" href={`https://www.openstreetmap.org/?mlat=${m.location.latitude}&mlon=${m.location.longitude}#map=16/${m.location.latitude}/${m.location.longitude}`} target="_blank" rel="noreferrer">
            <MapPin className="size-4" /> {m.location.name ?? `${m.location.latitude.toFixed(5)}, ${m.location.longitude.toFixed(5)}`}
          </a>
        )}
        {m.body && <p className={cn('whitespace-pre-wrap break-words text-[13.5px] leading-snug', m.deleted && 'text-muted line-through decoration-muted/50')}>{m.body}</p>}
        {m.deleted && <p className="text-[11px] italic text-muted">This message was deleted</p>}
        {m._error && <p className="text-[11px] text-danger">{m._error}</p>}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-muted">
          {m.edited && <span>edited</span>}
          {m.sent_via && m.sent_via !== 'whatsapp' && m.from_me && <span title={`Sent via ${m.sent_via}`}>· {m.sent_via}</span>}
          <time dateTime={m.timestamp}>{fmtTime(m.timestamp)}</time>
          <StatusIcon m={m} />
        </div>
        {reactions.length > 0 && (
          <div className="absolute -bottom-3 right-2 flex gap-0.5 rounded-full border bg-surface px-1.5 py-px text-xs shadow-sm">
            {reactions.map(([e, n]) => <span key={e}>{e}{n > 1 ? n : ''}</span>)}
          </div>
        )}
        {canSend && !m._pending && (
          <div className={cn('absolute top-0 hidden gap-0.5 rounded-md border bg-surface p-0.5 shadow-sm group-hover:flex group-focus-within:flex', m.from_me ? 'right-full mr-1' : 'left-full ml-1')}>
            <Tooltip content="Reply"><Button variant="ghost" size="icon-sm" className="size-7" onClick={() => onReply(m)} aria-label="Reply"><CornerUpLeft /></Button></Tooltip>
            <Popover.Root>
              <Popover.Trigger asChild><Button variant="ghost" size="icon-sm" className="size-7" aria-label="React"><SmilePlus /></Button></Popover.Trigger>
              <Popover.Portal>
                <Popover.Content sideOffset={4} className="z-50 flex gap-1 rounded-full border bg-surface p-1 shadow-lg">
                  {REACTIONS.map((e) => <Popover.Close key={e} asChild><button className="rounded-full p-1 text-lg hover:bg-surface-2 cursor-pointer" onClick={() => onReact(m, e)} aria-label={`React ${e}`}>{e}</button></Popover.Close>)}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── composer ─────────────────────────────

function ScheduleDialog({ open, onOpenChange, accountId, chat, text, onScheduled }: { open: boolean; onOpenChange: (o: boolean) => void; accountId: string; chat: Chat; text: string; onScheduled: () => void }) {
  const [body, setBody] = useState(text);
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setBody(text);
  }, [open, text]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Schedule message" description={`To ${chatTitle(chat)} · times are in ${displayTimezone()}`} />
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.post('/scheduled-messages', { account_id: accountId, chat_id: chat.wa_chat_id, text: body, scheduled_at: when, timezone: displayTimezone() }, { 'idempotency-key': idempotencyKey() });
            toast.success('Message scheduled');
            onScheduled();
            onOpenChange(false);
          } catch (err) {
            toastError(err);
          } finally {
            setBusy(false);
          }
        }}>
          <Field label="Message" htmlFor="sm"><Textarea id="sm" required value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4096} /></Field>
          <Field label="Send at" htmlFor="sw"><Input id="sw" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy || !body.trim()}>Schedule</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Composer({ accountId, chat, ready, onSent, reply, clearReply }: { accountId: string; chat: Chat; ready: boolean; onSent: (m: Message | null, temp?: Message) => void; reply: Message | null; clearReply: () => void }) {
  const [text, setText] = useState(chat.draft ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [asDoc, setAsDoc] = useState(false);
  const [sending, setSending] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    setText(chat.draft ?? '');
    setFile(null);
  }, [chat.id]);
  // Save local drafts (debounced).
  useEffect(() => {
    if (text === (chat.draft ?? '')) return;
    const t = setTimeout(() => void api.put(`/accounts/${accountId}/chats/${chat.id}/draft`, { body: text }).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [text, chat.id, accountId, chat.draft]);
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  }, [text]);

  const send = async () => {
    if (sending || (!text.trim() && !file)) return;
    setSending(true);
    const key = idempotencyKey();
    const temp: Message = {
      id: 'tmp-' + key, account_id: accountId, chat_id: chat.id, wa_message_id: '', direction: 'outbound', from_me: true, type: file ? 'document' : 'chat', body: text || (file ? file.name : ''),
      sender_wa_id: null, sender_name: null, status: 'pending', timestamp: new Date().toISOString(), has_media: !!file, quoted: reply ? { wa_message_id: reply.wa_message_id, body: reply.body } : null,
      forwarded: false, edited: false, deleted: false, location: null, sent_via: 'dashboard', attachments: [], reactions: [], _pending: true,
    };
    onSent(null, temp);
    try {
      let res: { status: string; message: Message | null; approval_id?: string };
      if (file) {
        const fd = new FormData();
        fd.set('file', file);
        fd.set('chat_id', chat.wa_chat_id);
        if (text.trim()) fd.set('caption', text);
        if (asDoc) fd.set('send_as', 'document');
        if (reply) fd.set('quoted_message_id', reply.id);
        res = await api.post('/accounts/' + accountId + '/messages/media', fd, { 'idempotency-key': key });
      } else if (reply) {
        res = await api.post(`/accounts/${accountId}/messages/reply`, { message_id: reply.id, text }, { 'idempotency-key': key });
      } else {
        res = await api.post(`/accounts/${accountId}/messages/send`, { chat_id: chat.wa_chat_id, text }, { 'idempotency-key': key });
      }
      onSent(res.message, { ...temp, _pending: false });
      setText('');
      setFile(null);
      clearReply();
      void api.put(`/accounts/${accountId}/chats/${chat.id}/draft`, { body: '' }).catch(() => {});
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to send';
      onSent(null, { ...temp, _pending: false, _error: msg, status: 'failed' });
      toastError(e);
    } finally {
      setSending(false);
      qc.invalidateQueries({ queryKey: ['chats'] });
    }
  };

  if (chat.read_only) return <div className="border-t p-3 text-center text-[13px] text-muted">You can't send messages to this conversation.</div>;

  return (
    <div className="border-t bg-surface p-2.5">
      {reply && (
        <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-primary bg-surface-2 px-2.5 py-1.5 text-xs">
          <div className="min-w-0 flex-1"><p className="font-medium">Replying to {reply.from_me ? 'yourself' : reply.sender_name ?? chatTitle(chat)}</p><p className="truncate text-muted">{reply.body ?? reply.type}</p></div>
          <button onClick={clearReply} aria-label="Cancel reply" className="cursor-pointer"><X className="size-4" /></button>
        </div>
      )}
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-md border bg-surface-2 px-2.5 py-1.5 text-xs">
          <Paperclip className="size-4" />
          <span className="flex-1 truncate">{file.name} · {fmtBytes(file.size)}</span>
          <label className="flex items-center gap-1"><input type="checkbox" checked={asDoc} onChange={(e) => setAsDoc(e.target.checked)} /> Send as document</label>
          <button onClick={() => setFile(null)} aria-label="Remove attachment" className="cursor-pointer"><X className="size-4" /></button>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <Popover.Root>
          <Popover.Trigger asChild><Button variant="ghost" size="icon" aria-label="Insert emoji"><Smile /></Button></Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="top" align="start" sideOffset={6} className="z-50 grid w-72 grid-cols-8 gap-0.5 rounded-lg border bg-surface p-2 shadow-lg">
              {EMOJI.map((e) => <button key={e} className="rounded p-1 text-lg hover:bg-surface-2 cursor-pointer" onClick={() => { setText((t) => t + e); taRef.current?.focus(); }}>{e}</button>)}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label="Attach file"><Paperclip /></Button>
        <input ref={fileRef} type="file" hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv,.zip" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={ready ? (file ? 'Add a caption…' : 'Type a message') : 'Account is not connected — messages cannot be sent'}
          aria-label="Message"
          maxLength={4096}
          className="max-h-40 min-h-9 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm"
        />
        <Tooltip content="Schedule"><Button variant="ghost" size="icon" onClick={() => setSchedOpen(true)} aria-label="Schedule message"><CalendarClock /></Button></Tooltip>
        <Button size="icon" onClick={send} disabled={!ready || sending || (!text.trim() && !file)} aria-label="Send"><Send /></Button>
      </div>
      <ScheduleDialog open={schedOpen} onOpenChange={setSchedOpen} accountId={accountId} chat={chat} text={text} onScheduled={() => setText('')} />
    </div>
  );
}

// ───────────────────────────── conversation ─────────────────────────────

function Conversation({ accountId, chatId }: { accountId: string; chatId: string }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data: accounts } = useAccounts();
  const account = accounts?.find((a) => a.id === accountId);
  const ready = !!account?.ready;
  const canSend = can('messages:send', accountId, 'send');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState<Message | null>(null);
  const [temps, setTemps] = useState<Message[]>([]);
  const [backfilling, setBackfilling] = useState(false);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);

  const chatQ = useQuery({ queryKey: ['chat', accountId, chatId], queryFn: () => api.get<Chat>(`/accounts/${accountId}/chats/${chatId}`) });
  const msgKey = ['messages', accountId, chatId];
  const msgQ = useInfiniteQuery({
    queryKey: msgKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<MsgPage>(`/accounts/${accountId}/chats/${chatId}/messages${qs({ limit: 50, before: pageParam })}`),
    getNextPageParam: (last) => (last.has_more_local ? last.next_before ?? undefined : undefined),
  });
  const messages = useMemo(() => {
    const pages = msgQ.data?.pages ?? [];
    const all = [...pages].reverse().flatMap((p) => p.items);
    const seen = new Set<string>();
    return all.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  }, [msgQ.data]);
  const chat = chatQ.data;

  // Mark as read when opened.
  useEffect(() => {
    setTemps([]);
    setReply(null);
    stickToBottom.current = true;
    if (canSend) void api.post(`/accounts/${accountId}/chats/${chatId}/read`).then(() => qc.invalidateQueries({ queryKey: ['chats'] })).catch(() => {});
  }, [accountId, chatId]);

  // Real-time updates for this chat.
  useSocketEvent<{ message: Message }>('message.upsert', ({ message }) => {
    if (message.chat_id !== (chat?.id ?? chatId) || message.account_id !== accountId) return;
    qc.setQueryData<InfiniteData<MsgPage>>(msgKey, (old) => {
      if (!old) return old;
      const pages = old.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.id === message.id ? message : m)) }));
      const exists = pages.some((p) => p.items.some((m) => m.id === message.id));
      if (!exists) pages[0] = { ...pages[0], items: [...pages[0].items, message].sort((a, b) => a.timestamp.localeCompare(b.timestamp)) };
      return { ...old, pages };
    });
    if (!message.from_me && document.visibilityState === 'visible' && canSend) void api.post(`/accounts/${accountId}/chats/${chatId}/read`).catch(() => {});
  }, [accountId, chatId, chat?.id]);
  useSocketEvent<{ wa_message_id: string; status: string; account_id: string }>('message.ack', (e) => {
    if (e.account_id !== accountId) return;
    qc.setQueryData<InfiniteData<MsgPage>>(msgKey, (old) => old && { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.wa_message_id === e.wa_message_id ? { ...m, status: e.status } : m)) })) });
  }, [accountId, chatId]);

  // Scroll handling: stay pinned to bottom for new messages; preserve position when loading older ones.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    else if (prevHeight.current) el.scrollTop += el.scrollHeight - prevHeight.current;
    prevHeight.current = 0;
  }, [messages.length, temps.length]);

  const onScroll = () => {
    const el = scrollRef.current!;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && msgQ.hasNextPage && !msgQ.isFetchingNextPage) {
      prevHeight.current = el.scrollHeight;
      void msgQ.fetchNextPage();
    }
  };

  const onSent = (m: Message | null, temp?: Message) => {
    stickToBottom.current = true;
    if (temp && temp._pending) setTemps((t) => [...t, temp]);
    else if (temp) {
      setTemps((t) => (temp._error ? t.map((x) => (x.id === temp.id ? temp : x)) : t.filter((x) => x.id !== temp.id)));
    }
    if (m) qc.setQueryData<InfiniteData<MsgPage>>(msgKey, (old) => {
      if (!old) return old;
      if (old.pages.some((p) => p.items.some((x) => x.id === m.id))) return old;
      const pages = [...old.pages];
      pages[0] = { ...pages[0], items: [...pages[0].items, m] };
      return { ...old, pages };
    });
    if (!m && temp && !temp._pending && !temp._error) toast.message('Queued — awaiting approval or confirmation');
  };

  const react = async (m: Message, emoji: string) => {
    try {
      await api.post(`/accounts/${accountId}/messages/react`, { message_id: m.id, emoji }, { 'idempotency-key': idempotencyKey() });
    } catch (e) {
      toastError(e);
    }
  };

  const backfill = async () => {
    setBackfilling(true);
    try {
      const r = await api.post<{ added: number; sync_state: string }>(`/accounts/${accountId}/chats/${chatId}/backfill`, { count: 100 });
      toast.success(r.added ? `Loaded ${r.added} older messages` : 'No older messages available from WhatsApp Web');
      stickToBottom.current = false;
      prevHeight.current = scrollRef.current?.scrollHeight ?? 0;
      await qc.invalidateQueries({ queryKey: msgKey });
      await qc.invalidateQueries({ queryKey: ['chat', accountId, chatId] });
    } catch (e) {
      toastError(e);
    } finally {
      setBackfilling(false);
    }
  };

  if (chatQ.error) return <EmptyState title="Conversation not found" description={(chatQ.error as Error).message} />;
  if (!chat) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const syncState = msgQ.data?.pages[0]?.sync_state ?? chat.sync_state;
  const noMoreLocal = !msgQ.hasNextPage && !msgQ.isLoading;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b bg-surface px-3 py-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => navigate('/inbox')} aria-label="Back to conversations"><ArrowLeft /></Button>
        <Avatar src={chat.profile_pic_url} name={chatTitle(chat)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{chatTitle(chat)}</p>
          <p className="truncate text-xs text-muted">
            {chat.is_group ? `Group · ${chat.participant_count ?? 0} participants` : chat.contact?.phone_number ?? chat.wa_chat_id}
            {' · '}
            {account?.display_name}
          </p>
        </div>
        <span className="hidden text-xs text-muted sm:inline">{syncState === 'full' ? 'Fully synchronised' : syncState === 'partial' ? 'Partially synchronised' : 'Not synchronised'}</span>
      </header>
      {chat.is_group && chat.group?.description && <p className="line-clamp-1 border-b bg-surface-2 px-4 py-1 text-xs text-muted">{chat.group.description}</p>}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto bg-background px-3 py-3 md:px-6" aria-live="polite">
        {msgQ.isFetchingNextPage && <div className="py-2 text-center"><Spinner /></div>}
        {noMoreLocal && (
          <div className="mx-auto mb-3 max-w-md rounded-md border bg-surface px-3 py-2 text-center text-xs text-muted">
            {syncState === 'full'
              ? 'Start of the history available from WhatsApp Web.'
              : <>Older messages may exist on the phone but have not been synchronised.{ready && <Button variant="link" size="sm" className="ml-1 h-auto text-xs" disabled={backfilling} onClick={backfill}><History className="size-3" /> {backfilling ? 'Loading…' : 'Load older from WhatsApp'}</Button>}</>}
          </div>
        )}
        {msgQ.isLoading && <div className="py-10 text-center"><Spinner /></div>}
        <div className="grid gap-1.5">
          {[...messages, ...temps].map((m, i, arr) => (
            <div key={m.id} className={cn(m.reactions.length && 'mb-3')}>
              {(i === 0 || !sameDay(arr[i - 1].timestamp, m.timestamp)) && (
                <div className="my-2 text-center"><span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] text-muted">{fmtDay(m.timestamp)}</span></div>
              )}
              <Bubble m={m} isGroup={chat.is_group} onReply={setReply} onReact={react} canSend={canSend && ready} />
            </div>
          ))}
        </div>
      </div>
      {canSend ? (
        <Composer accountId={accountId} chat={chat} ready={ready} onSent={onSent} reply={reply} clearReply={() => setReply(null)} />
      ) : (
        <div className="border-t p-3 text-center text-[13px] text-muted">You have read-only access to this account.</div>
      )}
    </div>
  );
}

export default function Inbox() {
  const { accountId: routeAccount, chatId } = useParams();
  const [accountId, setAccountId] = useState(() => localStorage.getItem('ttw:inbox-account') ?? '');
  useEffect(() => localStorage.setItem('ttw:inbox-account', accountId), [accountId]);
  return (
    <div className="flex h-full">
      <aside className={cn('w-full shrink-0 border-r bg-surface md:w-80 lg:w-96', chatId && 'hidden md:block')}>
        <ChatList accountId={accountId} setAccountId={setAccountId} selected={chatId} />
      </aside>
      <section className={cn('min-w-0 flex-1', !chatId && 'hidden md:block')}>
        {routeAccount && chatId ? <Conversation key={chatId} accountId={routeAccount} chatId={chatId} /> : <EmptyState title="Select a conversation" description="Incoming messages appear here in real time." />}
      </section>
    </div>
  );
}
