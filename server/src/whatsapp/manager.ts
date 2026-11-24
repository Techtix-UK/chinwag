import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import wwebjs from 'whatsapp-web.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import type { AccountStatus } from '../generated/prisma/client.js';
import { logger, errMsg } from '../lib/logger.js';
import { Semaphore } from '../lib/semaphore.js';
import { AppError, conflict, notFound, unavailable } from '../lib/errors.js';
import { audit, systemEvent } from '../services/audit.js';
import { bus } from '../services/events.js';
import { settings } from '../services/settings.js';
import { serializeChat, serializeMessage } from '../services/serializers.js';
import { applyAck, applyEdit, applyReaction, applyRevoke, clearChatCache, initialSync, upsertChat, upsertMessage } from './sync.js';
import type { ClientFactory, WaClient, WaMessage } from './types.js';

const log = logger('whatsapp');
const { Client, LocalAuth } = wwebjs;

/** Sessions must be stable for this long before the automatic-recovery counter is reset. */
const STABLE_RESET_MS = 10 * 60_000;
const INIT_TIMEOUT_MS = 180_000;
const WATCHDOG_INTERVAL_MS = 60_000;
const AUTH_READY_TIMEOUT_MS = 10 * 60_000;

interface ManagedSession {
  accountId: string;
  generation: number;
  client: WaClient | null;
  status: AccountStatus;
  statusDetail: string | null;
  ready: boolean;
  qr: string | null;
  qrDataUrl: string | null;
  qrUpdatedAt: Date | null;
  retries: number;
  readyAt: number | null;
  reconnectTimer: NodeJS.Timeout | null;
  stopping: boolean;
  watchdogFailures: number;
  loadingPercent: number | null;
  startedAt: number;
  authenticatedAt: number | null;
}

export interface SessionSnapshot {
  accountId: string;
  status: AccountStatus;
  statusDetail: string | null;
  ready: boolean;
  hasQr: boolean;
  qrUpdatedAt: string | null;
  retries: number;
  readyAt: string | null;
  startedAt: string | null;
  browserPid: number | null;
  loadingPercent: number | null;
}

export function clientIdFor(accountId: string) {
  return `acc-${accountId}`;
}

export function authDirFor(accountId: string) {
  return path.join(env().sessionsDir, `session-${clientIdFor(accountId)}`);
}

export const defaultClientFactory: ClientFactory = ({ clientId, dataPath }) => {
  const e = env();
  const args = ['--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions'];
  if (e.CHROMIUM_DISABLE_SANDBOX) args.push('--no-sandbox', '--disable-setuid-sandbox');
  const client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath }),
    puppeteer: {
      headless: true,
      executablePath: e.CHROMIUM_PATH || undefined,
      args,
    },
    webVersionCache: { type: 'local', path: path.join(e.dataDir, 'wweb-cache') },
    qrMaxRetries: 8,
    takeoverOnConflict: false,
    deviceName: 'Chinwag',
    browserName: 'Chrome',
  } as any);
  // Naming the linked device is cosmetic. WhatsApp Web only exposes the module it uses on the
  // pairing page; on the main page it is lazily loaded and missing, which made initialisation
  // (and the post-QR re-injection) throw "Cannot read properties of null (reading 'info')".
  const setDeviceName = (client as any).setDeviceName?.bind(client);
  if (setDeviceName) {
    (client as any).setDeviceName = async (...args: unknown[]) => {
      try {
        await setDeviceName(...args);
      } catch (e) {
        log.debug('Could not set linked-device name (non-fatal)', { error: errMsg(e) });
      }
    };
  }
  return client;
};

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private limiter: Semaphore;
  private watchdog: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(private factory: ClientFactory = defaultClientFactory, concurrency = env().CHROMIUM_START_CONCURRENCY) {
    this.limiter = new Semaphore(concurrency);
  }

  // ───────────── lifecycle ─────────────

  async bootstrap() {
    await fs.mkdir(env().sessionsDir, { recursive: true, mode: 0o700 });
    await fs.chmod(env().sessionsDir, 0o700).catch(() => {});
    const accounts = await prisma().whatsappAccount.findMany();
    for (const a of accounts) {
      if (a.desiredState === 'CONNECTED') {
        void this.start(a.id, 'startup').catch((e) => log.error('Startup connect failed', { accountId: a.id, error: errMsg(e) }));
      } else if (!['LOGGED_OUT', 'AUTH_FAILED', 'SESSION_EXPIRED', 'ERROR', 'DISCONNECTED'].includes(a.status)) {
        await this.persistStatus(a.id, 'DISCONNECTED', null);
      }
    }
    this.watchdog = setInterval(() => void this.runWatchdog(), WATCHDOG_INTERVAL_MS);
    this.watchdog.unref();
  }

  async shutdown() {
    this.shuttingDown = true;
    if (this.watchdog) clearInterval(this.watchdog);
    await Promise.allSettled(
      [...this.sessions.values()].map(async (s) => {
        s.stopping = true;
        if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
        if (s.client) await withTimeout(s.client.destroy(), 15000).catch(() => {});
      }),
    );
  }

  snapshot(accountId: string): SessionSnapshot | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    return {
      accountId,
      status: s.status,
      statusDetail: s.statusDetail,
      ready: s.ready,
      hasQr: !!s.qr,
      qrUpdatedAt: s.qrUpdatedAt?.toISOString() ?? null,
      retries: s.retries,
      readyAt: s.readyAt ? new Date(s.readyAt).toISOString() : null,
      startedAt: new Date(s.startedAt).toISOString(),
      browserPid: this.browserPid(accountId),
      loadingPercent: s.loadingPercent,
    };
  }

  snapshots(): SessionSnapshot[] {
    return [...this.sessions.keys()].map((id) => this.snapshot(id)!).filter(Boolean);
  }

  browserPid(accountId: string): number | null {
    const c = this.sessions.get(accountId)?.client as any;
    try {
      return c?.pupBrowser?.process?.()?.pid ?? null;
    } catch {
      return null;
    }
  }

  qr(accountId: string): { qr: string; dataUrl: string; updatedAt: string } | null {
    const s = this.sessions.get(accountId);
    if (!s?.qr || !s.qrDataUrl) return null;
    return { qr: s.qr, dataUrl: s.qrDataUrl, updatedAt: s.qrUpdatedAt!.toISOString() };
  }

  isReady(accountId: string) {
    return !!this.sessions.get(accountId)?.ready;
  }

  /** Returns a ready client or throws 503 — never silently queues outbound work. */
  requireClient(accountId: string): WaClient {
    const s = this.sessions.get(accountId);
    if (!s || !s.ready || !s.client) {
      throw unavailable('WhatsApp account is not connected', { account_id: accountId, status: (s?.status ?? 'DISCONNECTED').toLowerCase() });
    }
    return s.client;
  }

  activeCount() {
    return [...this.sessions.values()].filter((s) => s.client && !s.stopping).length;
  }

  // ───────────── administrative operations ─────────────

  async connect(accountId: string) {
    await prisma().whatsappAccount.update({ where: { id: accountId }, data: { desiredState: 'CONNECTED' } });
    const s = this.sessions.get(accountId);
    if (s?.client && !s.stopping) return; // already running
    if (s) s.retries = 0;
    await this.start(accountId, 'manual');
  }

  async disconnect(accountId: string) {
    await prisma().whatsappAccount.update({ where: { id: accountId }, data: { desiredState: 'DISCONNECTED' } });
    await this.stop(accountId);
    await this.setStatus(accountId, 'DISCONNECTED', 'Disconnected by administrator');
    await prisma().whatsappAccount.update({ where: { id: accountId }, data: { lastDisconnectedAt: new Date() } });
    bus.publish({ type: 'account.disconnected', accountId, data: { reason: 'manual' }, webhook: true });
  }

  async restart(accountId: string) {
    await prisma().whatsappAccount.update({ where: { id: accountId }, data: { desiredState: 'CONNECTED' } });
    await this.stop(accountId);
    const s = this.sessions.get(accountId);
    if (s) s.retries = 0;
    await this.start(accountId, 'restart');
  }

  /** Log out the linked device and delete the stored session. */
  async logout(accountId: string) {
    await prisma().whatsappAccount.update({ where: { id: accountId }, data: { desiredState: 'DISCONNECTED' } });
    const s = this.sessions.get(accountId);
    if (s?.client && s.ready) {
      s.stopping = true;
      try {
        await withTimeout(s.client.logout(), 30000);
      } catch (e) {
        log.warn('Logout call failed; removing local session', { accountId, error: errMsg(e) });
      }
    }
    await this.stop(accountId);
    await this.removeAuthDir(accountId);
    await this.setStatus(accountId, 'LOGGED_OUT', 'Logged out — scan a new QR code to reconnect');
    await prisma().whatsappAccount.update({ where: { id: accountId }, data: { lastDisconnectedAt: new Date() } });
    bus.publish({ type: 'account.disconnected', accountId, data: { reason: 'logout' }, webhook: true });
  }

  /** Discard the stored session and begin a fresh QR pairing. */
  async reauthenticate(accountId: string) {
    await this.stop(accountId);
    await this.removeAuthDir(accountId);
    await prisma().whatsappAccount.update({ where: { id: accountId }, data: { desiredState: 'CONNECTED' } });
    const s = this.sessions.get(accountId);
    if (s) s.retries = 0;
    await this.start(accountId, 'reauthenticate');
  }

  async remove(accountId: string) {
    await this.stop(accountId);
    await this.removeAuthDir(accountId);
    this.sessions.delete(accountId);
    clearChatCache(accountId);
  }

  // ───────────── internals ─────────────

  private async removeAuthDir(accountId: string) {
    const dir = authDirFor(accountId);
    if (!dir.startsWith(path.resolve(env().sessionsDir) + path.sep)) return;
    await fs.rm(dir, { recursive: true, force: true }).catch((e) => log.warn('Could not remove session directory', { accountId, error: errMsg(e) }));
  }

  private getOrCreate(accountId: string): ManagedSession {
    let s = this.sessions.get(accountId);
    if (!s) {
      s = {
        accountId,
        generation: 0,
        client: null,
        status: 'DISCONNECTED',
        statusDetail: null,
        ready: false,
        qr: null,
        qrDataUrl: null,
        qrUpdatedAt: null,
        retries: 0,
        readyAt: null,
        reconnectTimer: null,
        stopping: false,
        watchdogFailures: 0,
        loadingPercent: null,
        startedAt: Date.now(),
        authenticatedAt: null,
      };
      this.sessions.set(accountId, s);
    }
    return s;
  }

  private async stop(accountId: string) {
    const s = this.sessions.get(accountId);
    if (!s) return;
    s.stopping = true;
    s.generation++;
    if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
    const client = s.client;
    s.client = null;
    s.ready = false;
    s.qr = s.qrDataUrl = null;
    if (client) {
      try {
        client.removeAllListeners();
        await withTimeout(client.destroy(), 20000);
      } catch (e) {
        log.warn('Client destroy failed', { accountId, error: errMsg(e) });
        try {
          (client as any).pupBrowser?.process?.()?.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }
  }

  async start(accountId: string, reason: string) {
    if (this.shuttingDown) return;
    const account = await prisma().whatsappAccount.findUnique({ where: { id: accountId } });
    if (!account) throw notFound('WhatsApp account');
    const s = this.getOrCreate(accountId);
    if (s.client && !s.stopping) return;
    const limit = settings().maxConnectedAccounts;
    if (this.activeCount() >= limit) {
      await this.setStatus(accountId, 'ERROR', `Maximum connected accounts (${limit}) reached`);
      throw conflict(`Maximum connected accounts (${limit}) reached`);
    }
    s.stopping = false;
    s.ready = false;
    s.generation++;
    s.startedAt = Date.now();
    s.watchdogFailures = 0;
    s.authenticatedAt = null;
    const gen = s.generation;
    const isCurrent = () => this.sessions.get(accountId)?.generation === gen && !s.stopping;

    const clientId = clientIdFor(accountId);
    await prisma().whatsappSession.upsert({
      where: { accountId },
      create: { accountId, clientId, authPath: authDirFor(accountId) },
      update: { authPath: authDirFor(accountId) },
    });
    await this.setStatus(accountId, reason === 'auto-recover' ? 'RECONNECTING' : 'INITIALISING', reason === 'auto-recover' ? `Reconnect attempt ${s.retries}` : null);

    let client: WaClient;
    try {
      client = this.factory({ accountId, clientId, dataPath: env().sessionsDir });
    } catch (e) {
      await this.setStatus(accountId, 'ERROR', `Could not create client: ${errMsg(e)}`);
      throw new AppError(500, 'client_error', 'Could not create WhatsApp client');
    }
    s.client = client;
    this.attach(accountId, client, gen, isCurrent);

    void this.limiter
      .run(async () => {
        if (!isCurrent()) return;
        log.info('Starting WhatsApp client', { accountId, reason });
        await withTimeout(client.initialize(), INIT_TIMEOUT_MS, 'Chromium/WhatsApp Web initialisation timed out');
        await fs.chmod(authDirFor(accountId), 0o700).catch(() => {});
        try {
          const ver = await client.getWWebVersion();
          await prisma().whatsappSession.update({ where: { accountId }, data: { wwebVersion: ver?.slice(0, 30) } });
        } catch {
          /* not critical */
        }
        this.watchBrowser(accountId, client, gen, isCurrent);
      })
      .catch((e) => {
        if (!isCurrent()) return;
        log.error('Client initialisation failed', { accountId, error: errMsg(e) });
        void this.handleFailure(accountId, gen, `Initialisation failed: ${errMsg(e)}`);
      });
  }

  private watchBrowser(accountId: string, client: WaClient, gen: number, isCurrent: () => boolean) {
    const browser = (client as any).pupBrowser;
    if (browser?.on) {
      browser.on('disconnected', () => {
        if (!isCurrent()) return;
        log.warn('Chromium process exited unexpectedly', { accountId });
        void this.handleFailure(accountId, gen, 'Chromium process exited unexpectedly');
      });
    }
    const page = (client as any).pupPage;
    if (page?.on) {
      page.on('error', (err: unknown) => {
        if (!isCurrent()) return;
        void this.handleFailure(accountId, gen, `WhatsApp Web page crashed: ${errMsg(err)}`);
      });
    }
  }

  /** Controlled automatic recovery with exponential back-off and a hard attempt limit. */
  private async handleFailure(accountId: string, gen: number, detail: string) {
    const s = this.sessions.get(accountId);
    if (!s || s.generation !== gen || this.shuttingDown) return;
    const wasReady = s.ready;
    await this.stop(accountId);
    s.stopping = false;
    await prisma().whatsappSession.update({ where: { accountId }, data: { lastError: detail.slice(0, 2000) } }).catch(() => {});
    await systemEvent('error', 'whatsapp', detail, { attempt: s.retries }, accountId);
    if (wasReady) {
      await prisma().whatsappAccount.update({ where: { id: accountId }, data: { lastDisconnectedAt: new Date() } }).catch(() => {});
      bus.publish({ type: 'account.disconnected', accountId, data: { reason: 'failure', detail }, webhook: true });
    }
    const account = await prisma().whatsappAccount.findUnique({ where: { id: accountId } });
    if (!account || account.desiredState !== 'CONNECTED') {
      await this.setStatus(accountId, 'DISCONNECTED', detail);
      return;
    }
    const limit = settings().connectionRetryLimit;
    if (s.retries >= limit) {
      await this.setStatus(accountId, 'ERROR', `${detail}. Automatic recovery stopped after ${s.retries} attempts — restart manually.`);
      await audit({ action: 'account.recovery_exhausted', accountId, result: 'failure', metadata: { attempts: s.retries } });
      return;
    }
    s.retries++;
    const delay = Math.min(5000 * 2 ** (s.retries - 1), 5 * 60_000) + Math.floor(Math.random() * 2000);
    await this.setStatus(accountId, 'RECONNECTING', `${detail}. Retrying in ${Math.round(delay / 1000)}s (attempt ${s.retries}/${limit})`);
    await prisma().whatsappSession.update({ where: { accountId }, data: { reconnectAttempts: s.retries } }).catch(() => {});
    s.reconnectTimer = setTimeout(() => {
      s.reconnectTimer = null;
      void this.start(accountId, 'auto-recover').catch((e) => log.error('Reconnect failed', { accountId, error: errMsg(e) }));
    }, delay);
    s.reconnectTimer.unref?.();
  }

  private async runWatchdog() {
    for (const s of this.sessions.values()) {
      // Authenticated but WhatsApp Web never became ready: restart (bounded by the retry limit).
      if (!s.ready && s.client && !s.stopping && s.authenticatedAt && Date.now() - s.authenticatedAt > AUTH_READY_TIMEOUT_MS) {
        s.authenticatedAt = null;
        void this.handleFailure(s.accountId, s.generation, `WhatsApp Web did not finish loading within ${AUTH_READY_TIMEOUT_MS / 60000} minutes of authentication`);
        continue;
      }
      if (!s.ready || !s.client || s.stopping) continue;
      if (s.readyAt && Date.now() - s.readyAt > STABLE_RESET_MS && s.retries > 0) s.retries = 0;
      const gen = s.generation;
      try {
        const state = await withTimeout(s.client.getState(), 20000, 'getState timed out');
        if (state && state !== 'CONNECTED') {
          s.statusDetail = `WhatsApp state: ${state}`;
          s.watchdogFailures++;
        } else s.watchdogFailures = 0;
      } catch (e) {
        s.watchdogFailures++;
        log.warn('Watchdog check failed', { accountId: s.accountId, error: errMsg(e) });
      }
      if (s.watchdogFailures >= 3) {
        void this.handleFailure(s.accountId, gen, 'Session unresponsive (watchdog)');
      }
    }
  }

  private async setStatus(accountId: string, status: AccountStatus, detail: string | null) {
    const s = this.getOrCreate(accountId);
    s.status = status;
    s.statusDetail = detail;
    await this.persistStatus(accountId, status, detail);
    bus.publish({ type: 'account.status', accountId, data: { status: status.toLowerCase(), status_detail: detail, ready: s.ready } });
  }

  private async persistStatus(accountId: string, status: AccountStatus, detail: string | null) {
    await prisma().whatsappAccount.update({ where: { id: accountId }, data: { status, statusDetail: detail?.slice(0, 500) ?? null } }).catch(() => {});
  }

  private attach(accountId: string, client: WaClient, gen: number, isCurrent: () => boolean) {
    const s = this.getOrCreate(accountId);
    // Message events are processed strictly in arrival order per account (ordering of previews, acks and edits).
    let messageQueue: Promise<void> = Promise.resolve();
    const ordered =
      <A extends unknown[]>(name: string, fn: (...args: A) => Promise<void>) =>
      (...args: A) => {
        if (!isCurrent()) return;
        messageQueue = messageQueue.then(() => (isCurrent() ? fn(...args) : undefined)).catch((e) => log.error(`Handler ${name} failed`, { accountId, error: errMsg(e) }));
      };
    const guard =
      <A extends unknown[]>(name: string, fn: (...args: A) => Promise<void> | void) =>
      (...args: A) => {
        if (!isCurrent()) return;
        Promise.resolve()
          .then(() => fn(...args))
          .catch((e) => log.error(`Handler ${name} failed`, { accountId, error: errMsg(e) }));
      };

    client.on(
      'qr',
      guard('qr', async (qr: string) => {
        s.qr = qr;
        s.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
        s.qrUpdatedAt = new Date();
        await prisma().whatsappSession.update({ where: { accountId }, data: { lastQrAt: new Date() } }).catch(() => {});
        await this.setStatus(accountId, 'AWAITING_QR', 'Scan the QR code with WhatsApp → Linked devices');
        // QR codes are only pushed to users who can manage this account.
        bus.publish({ type: 'account.qr', accountId, audience: 'manage', data: { data_url: s.qrDataUrl, updated_at: s.qrUpdatedAt.toISOString() } });
      }),
    );

    client.on(
      'authenticated',
      guard('authenticated', async () => {
        s.qr = s.qrDataUrl = null;
        s.authenticatedAt = Date.now();
        await this.setStatus(accountId, 'AUTHENTICATING', 'Authenticated — loading WhatsApp Web');
        bus.publish({ type: 'account.qr', accountId, audience: 'manage', data: { data_url: null } });
        await audit({ action: 'account.authenticated', accountId, source: 'system' });
      }),
    );

    client.on(
      'loading_screen',
      guard('loading_screen', async (percent: string | number) => {
        s.loadingPercent = Number(percent) || 0;
        if (s.status !== 'SYNCHRONISING') await this.setStatus(accountId, 'AUTHENTICATING', `Loading WhatsApp Web (${s.loadingPercent}%)`);
      }),
    );

    client.on(
      'auth_failure',
      guard('auth_failure', async (message: string) => {
        log.warn('Authentication failure', { accountId });
        await prisma().whatsappAccount.update({ where: { id: accountId }, data: { desiredState: 'DISCONNECTED' } });
        await this.stop(accountId);
        await this.setStatus(accountId, 'AUTH_FAILED', 'Authentication failed — reauthenticate the account');
        await audit({ action: 'account.authentication_failed', accountId, result: 'failure', metadata: { reason: String(message).slice(0, 200) } });
        bus.publish({ type: 'account.authentication_failed', accountId, data: { reason: 'auth_failure' }, webhook: true });
      }),
    );

    client.on(
      'ready',
      guard('ready', async () => {
        s.ready = true;
        s.readyAt = Date.now();
        s.qr = s.qrDataUrl = null;
        const info = client.info;
        const waId = info?.wid?._serialized ?? null;
        let pic: string | null = null;
        if (waId) pic = (await withTimeout(client.getProfilePicUrl(waId), 8000).catch(() => null)) ?? null;
        await prisma().whatsappAccount.update({
          where: { id: accountId },
          data: {
            waId,
            phoneNumber: info?.wid?.user ?? null,
            profileName: info?.pushname?.slice(0, 190) ?? null,
            platform: info?.platform ?? null,
            profilePicUrl: pic,
            lastConnectedAt: new Date(),
          },
        });
        await prisma().whatsappSession.update({ where: { accountId }, data: { lastReadyAt: new Date(), lastError: null } }).catch(() => {});
        await this.setStatus(accountId, 'SYNCHRONISING', 'Connected — synchronising recent conversations');
        await audit({ action: 'account.connected', accountId, source: 'system' });
        bus.publish({ type: 'account.connected', accountId, data: { wa_id: waId, phone_number: info?.wid?.user ? '+' + info.wid.user : null }, webhook: true });
        try {
          await initialSync(accountId, client, isCurrent);
        } catch (e) {
          log.warn('Initial sync failed', { accountId, error: errMsg(e) });
          await systemEvent('warn', 'sync', `Initial sync failed: ${errMsg(e)}`, {}, accountId);
        }
        if (isCurrent()) await this.setStatus(accountId, 'CONNECTED', null);
      }),
    );

    client.on(
      'disconnected',
      guard('disconnected', async (reason: string) => {
        log.warn('Client disconnected', { accountId, reason });
        if (reason === 'LOGOUT' || reason === 'UNPAIRED' || reason === 'UNPAIRED_IDLE') {
          await prisma().whatsappAccount.update({ where: { id: accountId }, data: { desiredState: 'DISCONNECTED', lastDisconnectedAt: new Date() } });
          await this.stop(accountId);
          await this.removeAuthDir(accountId);
          await this.setStatus(accountId, 'LOGGED_OUT', 'Device was unlinked from WhatsApp — scan a new QR code to reconnect');
          await audit({ action: 'account.logged_out', accountId, source: 'system', metadata: { reason } });
          bus.publish({ type: 'account.disconnected', accountId, data: { reason: 'logged_out' }, webhook: true });
          return;
        }
        if (reason === 'Max qrcode retries reached') {
          await prisma().whatsappAccount.update({ where: { id: accountId }, data: { desiredState: 'DISCONNECTED' } });
          await this.stop(accountId);
          await this.setStatus(accountId, 'SESSION_EXPIRED', 'QR code was not scanned in time — start pairing again');
          return;
        }
        await this.handleFailure(accountId, gen, `Disconnected: ${reason}`);
      }),
    );

    client.on(
      'change_state',
      guard('change_state', async (state: string) => {
        if (state === 'CONFLICT') s.statusDetail = 'WhatsApp Web is open elsewhere (conflict)';
        if (state === 'TOS_BLOCK' || state === 'SMB_TOS_BLOCK') {
          await systemEvent('error', 'whatsapp', `Account restricted by WhatsApp: ${state}`, {}, accountId);
        }
      }),
    );

    // message_create fires for inbound messages and for messages sent from any linked device.
    client.on(
      'message_create',
      ordered('message_create', async (msg: WaMessage) => {
        const res = await upsertMessage(accountId, msg, { live: true, downloadMedia: settings().autoDownloadMedia && !msg.fromMe });
        if (!res) return;
        const full = await prisma().message.findUnique({ where: { id: res.message.id }, include: { attachments: true, reactions: true, chat: true } });
        if (!full) return;
        const payload = serializeMessage(full);
        bus.publish({ type: 'message.upsert', accountId, data: { message: payload } });
        bus.publish({ type: 'chat.upsert', accountId, data: { chat: serializeChat(full.chat) } });
        if (res.created) {
          bus.publish({ type: full.direction === 'INBOUND' ? 'message.received' : 'message.sent', accountId, data: { message: payload, chat: { id: full.chat.id, wa_chat_id: full.chat.waChatId, name: full.chat.name } }, webhook: true });
        }
      }),
    );

    client.on(
      'message_ack',
      ordered('message_ack', async (msg: WaMessage, ack: number) => {
        const r = await applyAck(accountId, msg, ack);
        if (!r) return;
        bus.publish({ type: 'message.ack', accountId, data: { wa_message_id: r.waMessageId, status: r.status.toLowerCase() } });
        const evt = ack === -1 ? 'message.failed' : ack === 2 ? 'message.delivered' : ack >= 3 ? 'message.read' : null;
        if (evt) bus.publish({ type: evt, accountId, data: { wa_message_id: r.waMessageId, status: r.status.toLowerCase() }, webhook: true });
      }),
    );

    client.on(
      'message_edit',
      ordered('message_edit', async (msg: WaMessage, newBody: string) => {
        await applyEdit(accountId, msg, String(newBody ?? msg.body ?? ''));
        const row = await prisma().message.findUnique({ where: { accountId_waMessageId: { accountId, waMessageId: msg.id._serialized } }, include: { attachments: true, reactions: true } });
        if (row) bus.publish({ type: 'message.upsert', accountId, data: { message: serializeMessage(row) } });
      }),
    );

    client.on(
      'message_revoke_everyone',
      ordered('message_revoke_everyone', async (msg: WaMessage, before?: WaMessage | null) => {
        const id = before?.id?._serialized ?? msg.id._serialized;
        await applyRevoke(accountId, id);
        const row = await prisma().message.findUnique({ where: { accountId_waMessageId: { accountId, waMessageId: id } }, include: { attachments: true, reactions: true } });
        if (row) bus.publish({ type: 'message.upsert', accountId, data: { message: serializeMessage(row) } });
      }),
    );

    client.on(
      'message_reaction',
      ordered('message_reaction', async (reaction: any) => {
        const row = await applyReaction(accountId, reaction);
        if (row) bus.publish({ type: 'message.upsert', accountId, data: { message: serializeMessage(row) } });
      }),
    );

    const refreshChat = guard('chat_update', async (chat: any) => {
      if (!chat?.id?._serialized) return;
      const row = await upsertChat(accountId, chat);
      if (row) bus.publish({ type: 'chat.upsert', accountId, data: { chat: serializeChat(row) } });
    });
    client.on('chat_archived', refreshChat);
    client.on('unread_count', refreshChat);

    client.on(
      'group_update',
      guard('group_update', async (notification: any) => {
        const chatId = notification?.chatId ?? notification?.id?.remote;
        if (!chatId) return;
        const chat = await client.getChatById(chatId);
        await refreshChat(chat);
      }),
    );
    for (const evt of ['group_join', 'group_leave', 'group_admin_changed'] as const) {
      client.on(
        evt,
        guard(evt, async (notification: any) => {
          const chatId = notification?.chatId ?? notification?.id?.remote;
          if (!chatId) return;
          const chat = await client.getChatById(chatId);
          await refreshChat(chat);
        }),
      );
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message = 'Operation timed out'): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(message)), ms)))]).finally(() => clearTimeout(t));
}

let instance: SessionManager | null = null;
export function sessionManager(): SessionManager {
  instance ??= new SessionManager();
  return instance;
}
export function setSessionManager(m: SessionManager) {
  instance = m;
}
