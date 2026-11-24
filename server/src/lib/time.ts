import { validationError } from './errors.js';

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Parse an ISO 8601 date-time. Values without an offset are interpreted as wall-clock time in `tz`. */
export function parseLocalDateTime(value: string, tz: string): Date {
  if (!isValidTimezone(tz)) throw validationError('Unknown timezone');
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value.trim())) {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw validationError('Invalid date-time');
    return d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) throw validationError('Date-time must be ISO 8601, e.g. 2026-12-01T09:00');
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  const target = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  let guess = target;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    guess += target - asUtc;
  }
  return new Date(guess);
}
