import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

let client: PrismaClient | null = null;

function adapterConfig(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    connectionLimit: Number(u.searchParams.get('connection_limit') ?? 10),
    charset: 'utf8mb4',
    allowPublicKeyRetrieval: u.searchParams.get('allowPublicKeyRetrieval') === 'true',
    socketPath: u.searchParams.get('socket') ?? undefined,
  };
}

export function prisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({ adapter: new PrismaMariaDb(adapterConfig(env().DATABASE_URL)) });
  }
  return client;
}

export async function disconnectPrisma() {
  if (client) await client.$disconnect();
  client = null;
}

export async function dbPing(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const t = Date.now();
  try {
    await prisma().$queryRawUnsafe('SELECT 1');
    return { ok: true, latencyMs: Date.now() - t };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
}

/** True when migrations have been applied (core tables exist). */
export async function schemaReady(): Promise<boolean> {
  try {
    await prisma().applicationSetting.findFirst();
    await prisma().user.findFirst({ select: { id: true } });
    return true;
  } catch {
    return false;
  }
}

export type { PrismaClient };
