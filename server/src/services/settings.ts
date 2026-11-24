import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';

/** General application settings. Sensitive deployment values belong in environment variables. */
export const settingsSchema = z.object({
  appName: z.string().min(1).max(64),
  logoUrl: z.string().max(1024).nullable(),
  baseUrl: z.string().url(),
  defaultTimezone: z.string().min(1).max(64),
  defaultLanguage: z.string().min(2).max(16),
  sessionExpiryHours: z.number().int().min(1).max(720),
  sessionIdleMinutes: z.number().int().min(5).max(10080),
  messageRetentionDays: z.number().int().min(0).max(36500),
  mediaRetentionDays: z.number().int().min(0).max(36500),
  maxAttachmentMb: z.number().int().min(1).max(100),
  maxConnectedAccounts: z.number().int().min(1).max(200),
  initialSyncChats: z.number().int().min(0).max(1000),
  initialSyncMessagesPerChat: z.number().int().min(0).max(1000),
  autoDownloadMedia: z.boolean(),
  connectionRetryLimit: z.number().int().min(0).max(50),
  scheduledExpiryMinutes: z.number().int().min(1).max(10080),
  defaultApprovalPolicy: z.enum(['READ_ONLY', 'REQUIRE_APPROVAL', 'DIRECT']),
  apiRateLimitPerMinute: z.number().int().min(1).max(10000),
  auditRetentionDays: z.number().int().min(0).max(36500),
  loginMaxAttempts: z.number().int().min(3).max(50),
  loginLockoutMinutes: z.number().int().min(1).max(1440),
  passwordMinLength: z.number().int().min(10).max(128),
  allowDynamicClientRegistration: z.boolean(),
  setupCompleted: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return {
    appName: 'Techtix WhatsApp',
    logoUrl: null,
    baseUrl: env().baseUrl.toString().replace(/\/$/, ''),
    defaultTimezone: 'Europe/London',
    defaultLanguage: 'en-GB',
    sessionExpiryHours: 12,
    sessionIdleMinutes: 120,
    messageRetentionDays: 0,
    mediaRetentionDays: 0,
    maxAttachmentMb: 16,
    maxConnectedAccounts: 10,
    initialSyncChats: 50,
    initialSyncMessagesPerChat: 50,
    autoDownloadMedia: true,
    connectionRetryLimit: 5,
    scheduledExpiryMinutes: 60,
    defaultApprovalPolicy: 'REQUIRE_APPROVAL',
    apiRateLimitPerMinute: 120,
    auditRetentionDays: 365,
    loginMaxAttempts: 5,
    loginLockoutMinutes: 15,
    passwordMinLength: 12,
    allowDynamicClientRegistration: true,
    setupCompleted: false,
  };
}

let cache: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  const base = defaultSettings();
  try {
    const rows = await prisma().applicationSetting.findMany();
    for (const r of rows) {
      if (r.key in base) (base as any)[r.key] = r.value;
    }
  } catch {
    // tables not yet migrated — fall back to defaults
  }
  const parsed = settingsSchema.safeParse(base);
  cache = parsed.success ? parsed.data : { ...defaultSettings(), setupCompleted: base.setupCompleted };
  return cache;
}

export function settings(): Settings {
  return cache ?? defaultSettings();
}

export async function updateSettings(patch: Partial<Settings>, userId?: string): Promise<Settings> {
  const merged = settingsSchema.parse({ ...settings(), ...patch });
  await prisma().$transaction(
    Object.entries(patch).map(([key, _]) =>
      prisma().applicationSetting.upsert({
        where: { key },
        create: { key, value: (merged as any)[key], updatedBy: userId ?? null },
        update: { value: (merged as any)[key], updatedBy: userId ?? null },
      }),
    ),
  );
  cache = merged;
  return merged;
}

/** Allows tests to inject settings without a database. */
export function setSettingsCache(s: Partial<Settings>) {
  cache = { ...(cache ?? defaultSettings()), ...s };
}
