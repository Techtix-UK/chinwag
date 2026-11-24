import { z } from 'zod';
import path from 'node:path';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_URL: z.string().url().default('http://localhost:3100'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATA_DIR: z.string().default('/var/lib/chinwag'),
  APP_ENCRYPTION_KEY: z.string().default(''),
  SETUP_TOKEN: z.string().optional().default(''),
  CHROMIUM_PATH: z.string().optional().default(''),
  CHROMIUM_DISABLE_SANDBOX: bool,
  CHROMIUM_START_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  WEBHOOK_ALLOWED_PRIVATE_CIDRS: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  DISABLE_WHATSAPP: bool,
  DISABLE_WORKERS: bool,
});

export type Env = z.infer<typeof schema> & {
  dataDir: string;
  sessionsDir: string;
  mediaDir: string;
  tmpDir: string;
  baseUrl: URL;
  isProduction: boolean;
  secureCookies: boolean;
  mcpUrl: URL;
};

let cached: Env | null = null;

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const dataDir = path.resolve(e.DATA_DIR);
  const baseUrl = new URL(e.BASE_URL.replace(/\/+$/, ''));
  cached = {
    ...e,
    dataDir,
    sessionsDir: path.join(dataDir, 'sessions'),
    mediaDir: path.join(dataDir, 'media'),
    tmpDir: path.join(dataDir, 'tmp'),
    baseUrl,
    isProduction: e.NODE_ENV === 'production',
    secureCookies: baseUrl.protocol === 'https:',
    mcpUrl: new URL('/mcp', baseUrl),
  };
  return cached;
}

export function env(): Env {
  return cached ?? loadEnv();
}

/** Validation report used by the setup wizard and health page (never includes secret values). */
export function envReport(): { key: string; ok: boolean; message: string }[] {
  const e = env();
  const out: { key: string; ok: boolean; message: string }[] = [];
  out.push({ key: 'BASE_URL', ok: true, message: e.baseUrl.toString() });
  if (e.isProduction && e.baseUrl.protocol !== 'https:') {
    out.push({ key: 'BASE_URL', ok: false, message: 'BASE_URL must use HTTPS in production' });
  }
  let keyOk = false;
  try {
    keyOk = decodeKey(e.APP_ENCRYPTION_KEY).length === 32;
  } catch {
    keyOk = false;
  }
  out.push({
    key: 'APP_ENCRYPTION_KEY',
    ok: keyOk,
    message: keyOk ? 'Configured (32 bytes)' : 'Missing or invalid — must be 32 bytes, base64 or hex',
  });
  out.push({ key: 'DATA_DIR', ok: true, message: e.dataDir });
  out.push({
    key: 'HOST',
    ok: true,
    message: e.HOST === '127.0.0.1' || e.HOST === 'localhost' || e.HOST === '::1' ? `${e.HOST} (localhost only)` : `${e.HOST} — not bound to localhost`,
  });
  out.push({
    key: 'CHROMIUM_DISABLE_SANDBOX',
    ok: !e.CHROMIUM_DISABLE_SANDBOX,
    message: e.CHROMIUM_DISABLE_SANDBOX ? 'Chromium sandbox DISABLED — reduced isolation' : 'Chromium sandbox enabled',
  });
  return out;
}

export function decodeKey(value: string): Buffer {
  if (!value) throw new Error('APP_ENCRYPTION_KEY is not set');
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  const buf = Buffer.from(value, 'base64');
  if (buf.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to 32 bytes');
  return buf;
}
