import { Router } from 'express';
import { z } from 'zod';
import { login, SESSION_COOKIE } from '../../services/auth.js';
import { applyMigrations, assertSetupToken, checks, completeSetup, isSetupComplete } from '../../services/setup.js';
import { setupRateLimit } from '../middleware/security.js';
import { sessionCookieOptions } from '../middleware/auth.js';
import { route } from '../route.js';
import { onSetupComplete } from '../../runtime.js';

const token = z.object({ token: z.string().min(8).max(200) });

export function setupRoutes(r: Router) {
  route(r, {
    method: 'get', path: '/setup/status', summary: 'Whether initial setup is required', tags: ['Setup'], auth: 'public', internal: true,
    handler: async () => ({ setup_required: !(await isSetupComplete()) }),
  });

  route(r, {
    method: 'post', path: '/setup/checks', summary: 'Validate environment, database and Chromium', tags: ['Setup'], auth: 'public', internal: true,
    middleware: [setupRateLimit], body: token,
    handler: async ({ body }) => {
      await assertSetupToken(body.token);
      return checks();
    },
  });

  route(r, {
    method: 'post', path: '/setup/migrate', summary: 'Apply database migrations', tags: ['Setup'], auth: 'public', internal: true,
    middleware: [setupRateLimit], body: token,
    handler: async ({ body }) => {
      await assertSetupToken(body.token);
      return applyMigrations();
    },
  });

  route(r, {
    method: 'post', path: '/setup/complete', summary: 'Create the initial administrator and finish setup', tags: ['Setup'], auth: 'public', internal: true,
    middleware: [setupRateLimit],
    body: token.extend({
      admin: z.object({ name: z.string().min(1).max(191), email: z.string().email().max(191), password: z.string().min(1).max(256) }),
      base_url: z.string().url().max(255),
      timezone: z.string().min(1).max(64),
      security: z.object({
        session_expiry_hours: z.number().int().min(1).max(720).default(12),
        default_approval_policy: z.enum(['READ_ONLY', 'REQUIRE_APPROVAL', 'DIRECT']).default('REQUIRE_APPROVAL'),
        allow_dynamic_client_registration: z.boolean().default(true),
        login_max_attempts: z.number().int().min(3).max(50).default(5),
      }),
    }),
    handler: async ({ req, res, body }) => {
      await assertSetupToken(body.token);
      await completeSetup({
        admin: body.admin,
        baseUrl: body.base_url,
        timezone: body.timezone,
        security: {
          sessionExpiryHours: body.security.session_expiry_hours,
          defaultApprovalPolicy: body.security.default_approval_policy,
          allowDynamicClientRegistration: body.security.allow_dynamic_client_registration,
          loginMaxAttempts: body.security.login_max_attempts,
        },
      });
      await onSetupComplete();
      const result = await login(body.admin.email, body.admin.password, { ip: req.ip, userAgent: req.get('user-agent') });
      if (result.ok) res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
      return { ok: true, csrf_token: result.ok ? result.csrfToken : null };
    },
  });
}
