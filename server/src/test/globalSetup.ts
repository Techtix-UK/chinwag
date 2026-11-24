import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'mysql://chinwag:chinwag@127.0.0.1:3306/chinwag_test';
  const root = path.resolve(import.meta.dirname, '..', '..');
  execFileSync(path.join(root, '..', 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url, PRISMA_SKIP_POSTINSTALL_GENERATE: '1' }, stdio: 'pipe' });
}
