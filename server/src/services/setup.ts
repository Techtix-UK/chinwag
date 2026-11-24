import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { env, envReport } from '../config/env.js';
import { prisma, dbPing, schemaReady } from '../db/prisma.js';
import { randomToken, safeEqual } from '../lib/crypto.js';
import { conflict, forbidden, validationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';
import { chromiumVersion } from './health.js';
import { hashPassword, passwordProblems } from './passwords.js';
import { loadSettings, settings, updateSettings, type Settings } from './settings.js';
import { ensureRoles } from './users.js';
import { isValidTimezone } from './scheduler.js';

const exec = promisify(execFile);
const log = logger('setup');
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokenFile = () => path.join(env().dataDir, 'setup-token');

export async function isSetupComplete(): Promise<boolean> {
  if (!(await schemaReady())) return false;
  const s = await loadSettings();
  if (s.setupCompleted) return true;
  return false;
}

/** Ensure a one-time setup token exists (env SETUP_TOKEN or a generated 0600 file). */
export async function ensureSetupToken() {
  if (env().SETUP_TOKEN) return;
  await fs.mkdir(env().dataDir, { recursive: true, mode: 0o700 });
  try {
    await fs.access(tokenFile());
  } catch {
    await fs.writeFile(tokenFile(), randomToken(24) + '\n', { mode: 0o600 });
    log.warn(`Setup required. One-time setup token written to ${tokenFile()} (readable only by the service user).`);
  }
}

async function currentToken(): Promise<string | null> {
  if (env().SETUP_TOKEN) return env().SETUP_TOKEN;
  try {
    return (await fs.readFile(tokenFile(), 'utf8')).trim();
  } catch {
    return null;
  }
}

export async function assertSetupToken(token: string | undefined) {
  if (await isSetupComplete()) throw conflict('Setup has already been completed');
  const expected = await currentToken();
  if (!expected || !token || !safeEqual(token, expected)) throw forbidden('Invalid setup token');
}

async function migrationStatus() {
  const dir = path.join(serverRoot, 'prisma', 'migrations');
  let expected: string[] = [];
  try {
    expected = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    /* none */
  }
  let applied: string[] = [];
  try {
    const rows = await prisma().$queryRawUnsafe<{ migration_name: string }[]>('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    applied = rows.map((r) => r.migration_name);
  } catch {
    /* table missing */
  }
  const pending = expected.filter((m) => !applied.includes(m));
  return { expected: expected.length, applied: applied.length, pending };
}

export async function checks() {
  const [db, chromium] = await Promise.all([dbPing(), chromiumVersion()]);
  const migrations = db.ok ? await migrationStatus() : { expected: 0, applied: 0, pending: [] as string[] };
  let dataDirWritable = false;
  try {
    await fs.mkdir(env().dataDir, { recursive: true, mode: 0o700 });
    const probe = path.join(env().dataDir, '.write-test');
    await fs.writeFile(probe, 'ok', { mode: 0o600 });
    await fs.rm(probe);
    dataDirWritable = true;
  } catch {
    dataDirWritable = false;
  }
  return {
    environment: envReport(),
    data_dir: { path: env().dataDir, writable: dataDirWritable },
    database: db,
    migrations,
    chromium: { ok: !!chromium.version, version: chromium.version, path: chromium.path, error: chromium.error ?? null },
    defaults: { base_url: settings().baseUrl, timezone: settings().defaultTimezone },
  };
}

export async function applyMigrations() {
  const bin = path.join(serverRoot, 'node_modules', '.bin', 'prisma');
  const rootBin = path.join(serverRoot, '..', 'node_modules', '.bin', 'prisma');
  const cmd = await fs.access(bin).then(() => bin).catch(() => rootBin);
  try {
    const { stdout, stderr } = await exec(cmd, ['migrate', 'deploy'], { cwd: serverRoot, timeout: 180_000, env: { ...process.env } });
    return { ok: true, output: (stdout + stderr).split('\n').filter((l) => !/password|DATABASE_URL/i.test(l)).slice(-30).join('\n') };
  } catch (e: any) {
    return { ok: false, output: String(e?.stderr ?? e?.message ?? e).split('\n').filter((l: string) => !/password/i.test(l)).slice(-30).join('\n') };
  }
}

export async function completeSetup(input: {
  admin: { name: string; email: string; password: string };
  baseUrl: string;
  timezone: string;
  security: Pick<Settings, 'sessionExpiryHours' | 'defaultApprovalPolicy' | 'allowDynamicClientRegistration' | 'loginMaxAttempts'>;
}) {
  if (!(await schemaReady())) throw conflict('Database migrations have not been applied');
  if (await prisma().user.count()) throw conflict('Users already exist — setup cannot create another initial administrator');
  if (!isValidTimezone(input.timezone)) throw validationError('Unknown timezone');
  const email = input.admin.email.trim().toLowerCase();
  const problems = passwordProblems(input.admin.password, settings().passwordMinLength, [input.admin.name, email.split('@')[0]]);
  if (problems.length) throw validationError(problems[0], { problems });
  await ensureRoles();
  const role = await prisma().role.findUniqueOrThrow({ where: { key: 'super_admin' } });
  const user = await prisma().user.create({
    data: { email, name: input.admin.name.trim(), passwordHash: await hashPassword(input.admin.password), timezone: input.timezone, roles: { create: [{ roleId: role.id }] } },
  });
  await updateSettings({ baseUrl: input.baseUrl.replace(/\/$/, ''), defaultTimezone: input.timezone, ...input.security, setupCompleted: true }, user.id);
  await fs.rm(tokenFile(), { force: true }).catch(() => {});
  await audit({ action: 'setup.completed', actor: { type: 'user', id: user.id, label: email }, source: 'setup' });
  return user;
}
