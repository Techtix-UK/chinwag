import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let userTz: string | undefined;
export function setDisplayTimezone(tz: string | undefined) {
  userTz = tz;
}
export function displayTimezone() {
  return userTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** All timestamps from the API are UTC ISO strings; render them in the user's selected timezone. */
export function fmtDateTime(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: displayTimezone() }).format(new Date(iso));
}

export function fmtTime(iso: string | null | undefined) {
  return fmtDateTime(iso, { hour: '2-digit', minute: '2-digit' });
}

function dayKey(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: displayTimezone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Compact timestamp for lists: time today, weekday this week, otherwise date. */
export function fmtRelativeShort(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return fmtTime(iso);
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 6) return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: displayTimezone() }).format(d);
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: diff > 300 ? '2-digit' : undefined, timeZone: displayTimezone() }).format(d);
}

export function fmtDay(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: displayTimezone() }).format(new Date(iso));
}
export function sameDay(a: string, b: string) {
  return dayKey(new Date(a)) === dayKey(new Date(b));
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  if (Math.abs(s) < 60) return rtf.format(-s, 'second');
  if (Math.abs(s) < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

export function fmtBytes(n: number | null | undefined) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function initials(name: string | null | undefined) {
  const s = (name ?? '').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (!s) return '#';
  const parts = s.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function chatTitle(c: { name: string | null; wa_chat_id: string }) {
  if (c.name) return c.name;
  const num = c.wa_chat_id.split('@')[0];
  return /^\d+$/.test(num) ? '+' + num : c.wa_chat_id;
}

/** Wall-clock "YYYY-MM-DDTHH:mm" in the display timezone, for datetime-local inputs. */
export function toLocalInput(iso: string | Date) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: displayTimezone(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export const TIMEZONES: string[] = (() => {
  try {
    return (Intl as any).supportedValuesOf('timeZone') as string[];
  } catch {
    return ['UTC', 'Europe/London', 'Africa/Johannesburg'];
  }
})();
