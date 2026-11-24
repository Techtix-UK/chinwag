/* Minimal structured logger. Writes JSON lines in production, readable lines in development.
   Never pass secrets, tokens or full message bodies to the logger. */
type Level = 'error' | 'warn' | 'info' | 'debug';
const order: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

let threshold: Level = (process.env.LOG_LEVEL as Level) || 'info';
const json = process.env.NODE_ENV === 'production';

export function setLogLevel(l: Level) {
  threshold = l;
}

function write(level: Level, component: string, msg: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  if (order[level] > order[threshold]) return;
  const ts = new Date().toISOString();
  if (json) {
    const line = JSON.stringify({ ts, level, component, msg, ...(meta ?? {}) });
    (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
  } else {
    const m = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    (level === 'error' ? process.stderr : process.stdout).write(`${ts} ${level.toUpperCase().padEnd(5)} [${component}] ${msg}${m}\n`);
  }
}

export function logger(component: string) {
  return {
    error: (msg: string, meta?: Record<string, unknown>) => write('error', component, msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => write('warn', component, msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => write('info', component, msg, meta),
    debug: (msg: string, meta?: Record<string, unknown>) => write('debug', component, msg, meta),
  };
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
