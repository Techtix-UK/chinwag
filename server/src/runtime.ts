import { logger, errMsg } from './lib/logger.js';
import { env } from './config/env.js';
import { loadSettings } from './services/settings.js';
import { ensureRoles } from './services/users.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { startWebhookWorker, stopWebhookWorker } from './services/webhooks.js';
import { startRetention, stopRetention } from './services/retention.js';
import { sessionManager } from './whatsapp/manager.js';

const log = logger('runtime');
let started = false;

/** Start background services (WhatsApp sessions, scheduler, webhooks, retention). Idempotent. */
export async function startRuntime() {
  if (started) return;
  started = true;
  await loadSettings();
  await ensureRoles();
  if (!env().DISABLE_WORKERS) {
    startWebhookWorker();
    startScheduler();
    startRetention();
  }
  if (!env().DISABLE_WHATSAPP) {
    await sessionManager().bootstrap().catch((e) => log.error('WhatsApp bootstrap failed', { error: errMsg(e) }));
  }
  log.info('Runtime started');
}

export async function stopRuntime() {
  stopScheduler();
  stopWebhookWorker();
  stopRetention();
  await sessionManager().shutdown();
}

export async function onSetupComplete() {
  await loadSettings();
  await startRuntime();
}
