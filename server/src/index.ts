import http from 'node:http';
import fs from 'node:fs/promises';
import { loadEnv, env } from './config/env.js';
import { logger, errMsg, setLogLevel } from './lib/logger.js';

loadEnv();
setLogLevel(env().LOG_LEVEL);
const log = logger('main');

const { createApp } = await import('./app.js');
const { attachRealtime } = await import('./realtime/socket.js');
const { disconnectPrisma, schemaReady } = await import('./db/prisma.js');
const { loadSettings } = await import('./services/settings.js');
const { ensureSetupToken, isSetupComplete } = await import('./services/setup.js');
const { startRuntime, stopRuntime } = await import('./runtime.js');

async function main() {
  if (env().isProduction && process.getuid?.() === 0 && process.env.ALLOW_ROOT !== 'true') {
    throw new Error('Refusing to run as root. Run Chinwag as its dedicated service user (see https://techtix-uk.github.io/chinwag/guide/installation).');
  }
  for (const dir of [env().dataDir, env().sessionsDir, env().mediaDir, env().tmpDir]) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700).catch(() => {});
  }
  await loadSettings();
  const app = createApp();
  const server = http.createServer(app);
  server.requestTimeout = 10 * 60_000;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 60_000;
  attachRealtime(server);

  await new Promise<void>((resolve) => server.listen(env().PORT, env().HOST, resolve));
  log.info(`Chinwag listening on http://${env().HOST}:${env().PORT} (public URL ${env().baseUrl.origin})`);

  if (await isSetupComplete()) {
    await startRuntime();
  } else {
    await ensureSetupToken();
    log.warn(`Initial setup required — open ${new URL('/setup', env().baseUrl)}${(await schemaReady()) ? '' : ' (database migrations pending)'}`);
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`Received ${signal}, shutting down gracefully`);
    server.close();
    const timer = setTimeout(() => process.exit(1), 30_000);
    timer.unref();
    try {
      await stopRuntime();
      await disconnectPrisma();
    } catch (e) {
      log.error('Error during shutdown', { error: errMsg(e) });
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => log.error('Unhandled rejection', { error: errMsg(e) }));
  process.on('uncaughtException', (e) => log.error('Uncaught exception', { error: errMsg(e), stack: e.stack?.split('\n').slice(0, 5).join(' | ') }));
}

main().catch((e) => {
  log.error('Fatal start-up error', { error: errMsg(e) });
  process.exit(1);
});
