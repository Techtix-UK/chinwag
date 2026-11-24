/** Telephone number helpers. WhatsApp identifies users by international number without '+'. */

export function digitsOnly(input: string): string {
  return input.replace(/[^\d]/g, '');
}

/**
 * Normalise an international number to E.164 digits (no '+'). Accepts "+44 7700 900123",
 * "0044...", "44 7700...". Local numbers without a country code are rejected because guessing
 * the country could message the wrong person.
 */
export function normaliseInternational(input: string): string | null {
  let s = input.trim();
  if (s.startsWith('00')) s = '+' + s.slice(2);
  const hasPlus = s.startsWith('+');
  const d = digitsOnly(s);
  if (d.length < 8 || d.length > 15) return null;
  if (!hasPlus && d.startsWith('0')) return null; // national format — country unknown
  return d;
}

export function formatInternational(digits: string | null | undefined): string | null {
  if (!digits) return null;
  return '+' + digits;
}

export function waIdToPhone(waId: string): string | null {
  const m = /^(\d{6,15})@c\.us$/.exec(waId);
  return m ? m[1] : null;
}

export function isChatId(s: string): boolean {
  return /^[\w.+-]+@(c\.us|g\.us|lid|broadcast|newsletter)$/.test(s);
}
