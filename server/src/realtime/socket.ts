import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { parseCookie } from 'cookie';
import { env } from '../config/env.js';
import { resolveSession, SESSION_COOKIE } from '../services/auth.js';
import { bus, type BusEvent } from '../services/events.js';
import { accountsWith, can, type Principal } from '../services/permissions.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';

const log = logger('realtime');
let io: Server | null = null;

/** Dashboard real-time channel. Authenticated by the session cookie; rooms are per account and per permission. */
export function attachRealtime(server: HttpServer) {
  io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    cors: env().isProduction ? undefined : { origin: [/^http:\/\/localhost:\d+$/], credentials: true },
    maxHttpBufferSize: 64 * 1024,
  });

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (env().isProduction && origin && origin !== env().baseUrl.origin) return next(new Error('forbidden origin'));
      const token = parseCookie(socket.handshake.headers.cookie ?? '')[SESSION_COOKIE];
      const p = await resolveSession(token);
      if (!p || !can(p, 'dashboard:access')) return next(new Error('unauthorized'));
      socket.data.principal = p;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const p = socket.data.principal as Principal;
    socket.join(`user:${p.id}`);
    socket.join(`session:${p.sessionId}`);
    const readable = accountsWith(p, 'chats:read');
    const managed = accountsWith(p, 'accounts:manage');
    const reviewable = accountsWith(p, 'approvals:review');
    const all = readable === 'all' || managed === 'all' || reviewable === 'all' ? (await prisma().whatsappAccount.findMany({ select: { id: true } })).map((a) => a.id) : [];
    for (const id of readable === 'all' ? all : readable) socket.join(`acct:${id}`);
    for (const id of managed === 'all' ? all : managed) socket.join(`acct-manage:${id}`);
    for (const id of reviewable === 'all' ? all : reviewable) socket.join(`acct-review:${id}`);
    if (p.isSuperAdmin) socket.join('super');
    // Accounts created after connecting: super admins pick them up via the 'super' room.
  });

  bus.on('event', (evt: BusEvent) => {
    if (!io) return;
    const rooms: string[] = [];
    if (evt.accountId) {
      const prefix = evt.audience === 'manage' ? 'acct-manage' : evt.audience === 'reviewers' ? 'acct-review' : 'acct';
      rooms.push(`${prefix}:${evt.accountId}`);
    }
    rooms.push('super');
    io.to(rooms).emit(evt.type, { account_id: evt.accountId ?? null, ...evt.data });
  });

  log.info('Real-time channel ready');
  return io;
}

export function disconnectUserSockets(userId: string) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}
