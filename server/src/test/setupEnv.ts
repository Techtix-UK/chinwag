import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Tests run against a dedicated database (TEST_DATABASE_URL) with WhatsApp mocked.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'mysql://chinwag:chinwag@127.0.0.1:3306/chinwag_test';
process.env.BASE_URL = 'http://localhost:3999';
process.env.PORT = '3999';
process.env.DATA_DIR = path.join(os.tmpdir(), `ttw-test-${process.pid}`);
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY_TEST ?? crypto.randomBytes(32).toString('base64');
process.env.DISABLE_WHATSAPP = 'true';
process.env.DISABLE_WORKERS = 'true';
process.env.CHROMIUM_PATH = '';
