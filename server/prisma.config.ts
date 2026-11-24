import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Load ../.env for CLI commands (migrate, generate) without extra dependencies.
for (const p of ['../.env', '.env']) {
  if (existsSync(p) && !process.env.DATABASE_URL) process.loadEnvFile(p);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '', ...(process.env.SHADOW_DATABASE_URL ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } : {}) },
});
