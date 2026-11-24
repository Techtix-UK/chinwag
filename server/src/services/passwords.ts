import argon2 from 'argon2';

// OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** A dummy hash used to equalise timing when the user does not exist. */
let dummy: string | null = null;
export async function dummyVerify(password: string) {
  dummy ??= await hashPassword('timing-equaliser-' + Math.random());
  await verifyPassword(dummy, password);
}

export function passwordProblems(password: string, minLength: number, context: string[] = []): string[] {
  const problems: string[] = [];
  if (password.length < minLength) problems.push(`Password must be at least ${minLength} characters`);
  if (password.length > 256) problems.push('Password must be at most 256 characters');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) problems.push('Use at least three of: lowercase, uppercase, digits, symbols');
  const lower = password.toLowerCase();
  for (const c of context) {
    if (c && c.length >= 4 && lower.includes(c.toLowerCase())) problems.push('Password must not contain your name or email');
  }
  if (/^(.)\1+$/.test(password) || /password|qwerty|123456|techtix|whatsapp/i.test(password)) problems.push('Password is too easy to guess');
  return [...new Set(problems)];
}
