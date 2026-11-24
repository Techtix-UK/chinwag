// PM2 process definition for Chinwag.
// IMPORTANT: exactly ONE instance in fork mode. The process owns the WhatsApp Web sessions and their
// Chromium browsers; cluster mode or multiple instances would start competing duplicate sessions.
const path = require('node:path');

const name = process.env.CHINWAG_PM2_NAME || 'chinwag';
const logDir = process.env.CHINWAG_LOG_DIR || '/var/log/chinwag';

module.exports = {
  apps: [
    {
      name,
      cwd: path.join(__dirname, 'server'),
      script: 'dist/index.js',
      node_args: '--env-file=../.env --enable-source-maps',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      kill_timeout: 35000, // allow graceful shutdown of Chromium sessions
      max_memory_restart: '1G', // Node process only; Chromium children are separate processes
      time: true,
      out_file: path.join(logDir, 'out.log'),
      error_file: path.join(logDir, 'error.log'),
      merge_logs: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
