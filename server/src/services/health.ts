import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { prisma, dbPing } from '../db/prisma.js';
import { env } from '../config/env.js';
import { sessionManager } from '../whatsapp/manager.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const startedAt = Date.now();

function pkgVersion(name: string): string | null {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    // Packages whose "exports" hide package.json: walk up from the resolved entry point.
    try {
      let dir = path.dirname(require.resolve(name));
      for (let i = 0; i < 6; i++) {
        const f = path.join(dir, 'package.json');
        if (existsSync(f)) {
          const pkg = JSON.parse(readFileSync(f, 'utf8'));
          if (pkg.name === name) return pkg.version;
        }
        dir = path.dirname(dir);
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** Available memory: MemAvailable on Linux (excludes reclaimable cache), os.freemem elsewhere. */
async function availableMemory(): Promise<number> {
  try {
    const info = await fs.readFile('/proc/meminfo', 'utf8');
    const m = /MemAvailable:\s+(\d+) kB/.exec(info);
    if (m) return Number(m[1]) * 1024;
  } catch {
    /* not Linux */
  }
  return os.freemem();
}

let chromiumVersionCache: { at: number; value: string | null; error?: string } | null = null;
export async function chromiumVersion(): Promise<{ version: string | null; path: string; error?: string }> {
  const path = env().CHROMIUM_PATH;
  if (chromiumVersionCache && Date.now() - chromiumVersionCache.at < 10 * 60_000) return { version: chromiumVersionCache.value, path, error: chromiumVersionCache.error };
  if (!path) {
    chromiumVersionCache = { at: Date.now(), value: null, error: 'CHROMIUM_PATH is not set' };
    return { version: null, path, error: 'CHROMIUM_PATH is not set' };
  }
  try {
    const { stdout } = await exec(path, ['--version'], { timeout: 10000 });
    chromiumVersionCache = { at: Date.now(), value: stdout.trim() };
  } catch (e) {
    chromiumVersionCache = { at: Date.now(), value: null, error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
  return { version: chromiumVersionCache.value, path, error: chromiumVersionCache.error };
}

interface ProcInfo {
  pid: number;
  ppid: number;
  rssKb: number;
  cpu: number;
  comm: string;
}

async function processTable(): Promise<ProcInfo[]> {
  try {
    const { stdout } = await exec('ps', ['-A', '-o', 'pid=,ppid=,rss=,%cpu=,comm='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
    return stdout
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length >= 5)
      .map(([pid, ppid, rss, cpu, ...comm]) => ({ pid: Number(pid), ppid: Number(ppid), rssKb: Number(rss), cpu: Number(cpu), comm: comm.join(' ') }));
  } catch {
    return [];
  }
}

/** Resource usage of each account's Chromium process tree. */
export async function sessionResources(): Promise<Record<string, { pid: number | null; processes: number; memory_mb: number; cpu_percent: number }>> {
  const table = await processTable();
  const children = new Map<number, ProcInfo[]>();
  for (const p of table) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  const out: Record<string, { pid: number | null; processes: number; memory_mb: number; cpu_percent: number }> = {};
  for (const snap of sessionManager().snapshots()) {
    const root = snap.browserPid;
    if (!root) {
      out[snap.accountId] = { pid: null, processes: 0, memory_mb: 0, cpu_percent: 0 };
      continue;
    }
    const stack = [root];
    let count = 0, rss = 0, cpu = 0;
    const seen = new Set<number>();
    while (stack.length) {
      const pid = stack.pop()!;
      if (seen.has(pid)) continue;
      seen.add(pid);
      const info = table.find((t) => t.pid === pid);
      if (info) {
        count++;
        rss += info.rssKb;
        cpu += info.cpu;
      }
      for (const c of children.get(pid) ?? []) stack.push(c.pid);
    }
    out[snap.accountId] = { pid: root, processes: count, memory_mb: Math.round(rss / 1024), cpu_percent: Math.round(cpu * 10) / 10 };
  }
  return out;
}

let lastCpu = os.cpus().map((c) => c.times);
function cpuPercent(): number {
  const now = os.cpus().map((c) => c.times);
  let idle = 0, total = 0;
  now.forEach((t, i) => {
    const p = lastCpu[i] ?? t;
    const d = { user: t.user - p.user, nice: t.nice - p.nice, sys: t.sys - p.sys, idle: t.idle - p.idle, irq: t.irq - p.irq };
    idle += d.idle;
    total += d.user + d.nice + d.sys + d.idle + d.irq;
  });
  lastCpu = now;
  return total ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

export async function systemStatus(detailed: boolean) {
  const db = await dbPing();
  const m = sessionManager();
  const snaps = m.snapshots();
  const base = {
    status: db.ok ? 'ok' : 'degraded',
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    database: { ok: db.ok, latency_ms: db.latencyMs ?? null, error: detailed ? db.error ?? null : undefined },
    whatsapp: { connected: snaps.filter((s) => s.ready).length, sessions: snaps.length },
    mcp: { available: true, url: env().mcpUrl.toString() },
  };
  if (!detailed) return base;

  const [chromium, resources, table] = await Promise.all([chromiumVersion(), sessionResources(), processTable()]);
  let disk: { total_gb: number; free_gb: number; used_percent: number } | null = null;
  try {
    const st = await fs.statfs(env().dataDir);
    const total = st.blocks * st.bsize, free = st.bavail * st.bsize;
    disk = { total_gb: +(total / 1e9).toFixed(1), free_gb: +(free / 1e9).toFixed(1), used_percent: total ? Math.round((1 - free / total) * 1000) / 10 : 0 };
  } catch {
    disk = null;
  }
  const [pending, awaiting, processing, uncertain, webhookBacklog, errors] = await Promise.all([
    prisma().scheduledMessage.count({ where: { status: 'PENDING' } }).catch(() => 0),
    prisma().scheduledMessage.count({ where: { status: 'AWAITING_APPROVAL' } }).catch(() => 0),
    prisma().scheduledMessage.count({ where: { status: 'PROCESSING' } }).catch(() => 0),
    prisma().scheduledMessage.count({ where: { status: 'DELIVERY_UNCERTAIN' } }).catch(() => 0),
    prisma().webhookDelivery.count({ where: { status: { in: ['PENDING', 'RETRYING'] } } }).catch(() => 0),
    prisma().systemEvent.findMany({ where: { level: { in: ['error', 'warn'] } }, orderBy: { timestamp: 'desc' }, take: 25 }).catch(() => []),
  ]);
  const mem = process.memoryUsage();
  const chromiumProcs = Object.values(resources).reduce((n, r) => n + r.processes, 0);
  const availMem = await availableMemory();
  return {
    ...base,
    application: { name: 'Techtix WhatsApp', version: pkgVersion('@techtix-whatsapp/server') ?? '1.0.0', environment: env().NODE_ENV, pid: process.pid },
    versions: { node: process.version, whatsapp_web_js: pkgVersion('whatsapp-web.js'), puppeteer: pkgVersion('puppeteer'), mcp_sdk: pkgVersion('@modelcontextprotocol/sdk'), chromium: chromium.version, chromium_path: chromium.path, chromium_error: chromium.error ?? null },
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      cpu_count: os.cpus().length,
      cpu_percent: cpuPercent(),
      load_average: os.loadavg().map((n) => +n.toFixed(2)),
      memory: { total_mb: Math.round(os.totalmem() / 1048576), free_mb: Math.round(availMem / 1048576), process_rss_mb: Math.round(mem.rss / 1048576), heap_used_mb: Math.round(mem.heapUsed / 1048576) },
      disk,
    },
    chromium_processes: chromiumProcs,
    sessions: snaps.map((s) => ({ account_id: s.accountId, status: s.status.toLowerCase(), ready: s.ready, retries: s.retries, ready_at: s.readyAt, resources: resources[s.accountId] ?? null })),
    queues: { scheduled_pending: pending, scheduled_awaiting_approval: awaiting, scheduled_processing: processing, scheduled_delivery_uncertain: uncertain, webhook_backlog: webhookBacklog },
    recent_errors: errors.map((e) => ({ id: e.id, timestamp: e.timestamp.toISOString(), level: e.level, component: e.component, account_id: e.accountId, message: e.message })),
  };
}
