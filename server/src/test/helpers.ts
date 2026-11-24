import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import request from 'supertest';
import type { Express } from 'express';
import { loadEnv, env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { setSettingsCache, loadSettings, updateSettings } from '../services/settings.js';
import { ensureRoles } from '../services/users.js';
import { hashPassword } from '../services/passwords.js';
import { SessionManager, setSessionManager } from '../whatsapp/manager.js';
import type { ClientFactory } from '../whatsapp/types.js';

loadEnv();

/** Minimal stand-in for a whatsapp-web.js Client. */
export class FakeClient extends EventEmitter {
  info = { wid: { _serialized: '447700900001@c.us', user: '447700900001' }, pushname: 'Test Business', platform: 'android' };
  sent: { chatId: string; content: any; options: any }[] = [];
  failNextSend: Error | null = null;
  counter = 0;
  pupBrowser = null;
  async initialize() {
    setImmediate(() => this.emit('ready'));
  }
  async destroy() {}
  async logout() {}
  async getState() {
    return 'CONNECTED';
  }
  async getWWebVersion() {
    return '2.3000.0';
  }
  async getChats() {
    return [];
  }
  async getContacts() {
    return [];
  }
  async getProfilePicUrl() {
    return null;
  }
  async getNumberId(n: string) {
    return n.startsWith('999') ? null : { _serialized: `${n}@c.us`, user: n, server: 'c.us' };
  }
  async sendSeen() {
    return true;
  }
  async getChatById(id: string) {
    return this.fakeChat(id);
  }
  fakeChat(id: string) {
    return { id: { _serialized: id }, name: 'Customer ' + id.split('@')[0], isGroup: id.endsWith('@g.us'), unreadCount: 0, timestamp: Math.floor(Date.now() / 1000), archived: false, pinned: false, isMuted: false, isReadOnly: false, participants: [], fetchMessages: async () => [] };
  }
  fakeMessage(chatId: string, body: string, fromMe: boolean, id?: string) {
    const serialized = id ?? `${fromMe}_${chatId}_${++this.counter}${Date.now()}`;
    return {
      id: { _serialized: serialized, fromMe, remote: chatId, id: serialized },
      from: fromMe ? this.info.wid._serialized : chatId,
      to: fromMe ? chatId : this.info.wid._serialized,
      fromMe,
      body,
      type: 'chat',
      ack: fromMe ? 1 : 0,
      timestamp: Math.floor(Date.now() / 1000),
      hasMedia: false,
      hasQuotedMsg: false,
      isForwarded: false,
      _data: { notifyName: 'Customer' },
      getChat: async () => this.fakeChat(chatId),
      react: async () => {},
    };
  }
  async sendMessage(chatId: string, content: any, options: any) {
    if (this.failNextSend) {
      const e = this.failNextSend;
      this.failNextSend = null;
      throw e;
    }
    this.sent.push({ chatId, content, options });
    return this.fakeMessage(chatId, typeof content === 'string' ? content : options?.caption ?? '', true);
  }
  async getMessageById(id: string) {
    return { ...this.fakeMessage('x@c.us', '', false, id), react: async () => {} };
  }
}

export const clients = new Map<string, FakeClient>();
export const fakeFactory: ClientFactory = ({ accountId }) => {
  const c = new FakeClient();
  clients.set(accountId, c);
  return c as any;
};

let manager: SessionManager;
export function testManager() {
  return manager;
}

const TABLES = [
  'webhook_deliveries', 'webhooks', 'idempotency_keys', 'oauth_tokens', 'oauth_authorisations', 'oauth_authorization_requests', 'oauth_clients', 'api_keys',
  'message_approvals', 'scheduled_messages', 'message_drafts', 'message_reactions', 'message_attachments', 'messages', 'group_participants', 'chats',
  'contact_tags', 'contact_notes', 'contacts', 'whatsapp_sessions', 'user_account_permissions', 'whatsapp_accounts', 'user_sessions', 'user_roles', 'users',
  'audit_logs', 'system_events', 'application_settings',
];

export async function resetDb() {
  await prisma().$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
  for (const t of TABLES) await prisma().$executeRawUnsafe(`DELETE FROM \`${t}\``);
  await prisma().$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
  await ensureRoles();
  await fs.mkdir(env().mediaDir, { recursive: true });
  await updateSettings({ setupCompleted: true, loginMaxAttempts: 5 });
  await loadSettings();
  setSettingsCache({ setupCompleted: true });
  manager = new SessionManager(fakeFactory, 4);
  setSessionManager(manager);
  clients.clear();
}

export async function createUser(email: string, role: string, access: { accountId: string; level: 'READ' | 'SEND' | 'MANAGE' }[] = [], password = 'Correct-Horse-Battery-9') {
  const r = await prisma().role.findUniqueOrThrow({ where: { key: role } });
  return prisma().user.create({
    data: { email, name: email.split('@')[0], passwordHash: await hashPassword(password), roles: { create: [{ roleId: r.id }] }, accountPermissions: { create: access.map((a) => ({ accountId: a.accountId, level: a.level })) } },
  });
}

export async function createAccount(name: string, connect = true) {
  const a = await prisma().whatsappAccount.create({ data: { displayName: name, desiredState: connect ? 'CONNECTED' : 'DISCONNECTED' } });
  if (connect) {
    await manager.start(a.id, 'test');
    await waitFor(() => manager.isReady(a.id) && manager.snapshot(a.id)?.status === 'CONNECTED');
  }
  return a;
}

export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Logs in and returns an agent with the session cookie and CSRF header helpers. */
export async function loginAgent(app: Express, email: string, password = 'Correct-Horse-Battery-9') {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.data.csrf_token as string };
}
