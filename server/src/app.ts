import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import { mcpAuthRouter, createOAuthMetadata } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { audit } from './services/audit.js';
import { MCP_SCOPES } from './services/permissions.js';
import { authenticate } from './http/middleware/auth.js';
import { apiRateLimit, httpsEnforcement, securityHeaders } from './http/middleware/security.js';
import { errorBody, route } from './http/route.js';
import { AppError } from './lib/errors.js';
import { buildOpenApi } from './http/openapi.js';
import { authRoutes } from './http/routes/auth.js';
import { setupRoutes } from './http/routes/setup.js';
import { accountRoutes } from './http/routes/accounts.js';
import { chatRoutes } from './http/routes/chats.js';
import { contactRoutes } from './http/routes/contacts.js';
import { messagingRoutes } from './http/routes/messaging.js';
import { schedulingRoutes } from './http/routes/scheduling.js';
import { integrationRoutes } from './http/routes/integrations.js';
import { webhookRoutes } from './http/routes/webhooks.js';
import { adminRoutes } from './http/routes/admin.js';
import { oauthProvider } from './oauth/provider.js';
import { mountMcp } from './mcp/http.js';
import { systemStatus } from './services/health.js';
import { z } from 'zod';

const log = logger('http');
const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env().TRUST_PROXY);
  securityHeaders(app);
  app.use(httpsEnforcement);

  // ── OAuth 2.1 authorisation server (MCP SDK) + metadata ──
  const issuer = env().baseUrl;
  const metadata = { ...createOAuthMetadata({ provider: oauthProvider, issuerUrl: issuer, scopesSupported: [...MCP_SCOPES] }), client_id_metadata_document_supported: true };
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(metadata);
  });
  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: issuer,
      resourceServerUrl: env().mcpUrl,
      scopesSupported: [...MCP_SCOPES],
      resourceName: 'Chinwag',
      serviceDocumentationUrl: new URL('/api/docs', issuer),
      clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
    }),
  );

  // ── MCP (Streamable HTTP) ──
  mountMcp(app);

  // ── REST API v1 ──
  const api = express.Router();
  api.use(express.json({ limit: '150mb' }));
  api.use(authenticate);
  api.use(apiRateLimit);
  api.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    // API key requests are recorded in the activity log.
    if (req.principal?.type === 'api_key') {
      res.on('finish', () => {
        void audit({ action: 'api.request', actor: req.principal!, source: 'api', result: res.statusCode < 400 ? 'success' : res.statusCode === 403 ? 'denied' : 'failure', ip: req.ip, metadata: { method: req.method, path: (req.baseUrl + (req.route?.path ?? req.path)).slice(0, 200), status: res.statusCode } });
      });
    }
    next();
  });

  route(api, {
    method: 'get', path: '/health', summary: 'Liveness and basic health', tags: ['System'], auth: 'public',
    handler: async () => systemStatus(false),
  });
  setupRoutes(api);
  authRoutes(api);
  accountRoutes(api);
  chatRoutes(api);
  contactRoutes(api);
  messagingRoutes(api);
  schedulingRoutes(api);
  integrationRoutes(api);
  webhookRoutes(api);
  adminRoutes(api);
  route(api, {
    method: 'get', path: '/openapi.json', summary: 'OpenAPI document', tags: ['System'], auth: 'principal', internal: true, query: z.object({}),
    handler: async ({ res }) => {
      res.json(buildOpenApi());
    },
  });
  api.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found' } }));
  app.use('/api/v1', api);

  // ── Swagger UI (requires a dashboard session) ──
  app.use('/api/docs', authenticate, (req: Request, res: Response, next: NextFunction) => {
    if (!req.principal || req.principal.type !== 'user') return res.redirect('/login?next=/api/docs');
    next();
  }, swaggerUi.serve, swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/v1/openapi.json', withCredentials: true }, customSiteTitle: 'Chinwag API' }));

  // ── Dashboard SPA ──
  const webDist = path.resolve(here, '..', '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/^(?!\/(api|mcp|socket\.io|\.well-known|authorize|token|register|revoke)(\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // ── Errors ──
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const anyErr = err as any;
    if (anyErr?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body too large' } });
    if (anyErr?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
    const { status, body } = errorBody(err);
    if (status >= 500 && !(err instanceof AppError)) log.error('Unhandled error', { path: req.path, requestId: req.requestId, error: err instanceof Error ? err.stack?.split('\n').slice(0, 4).join(' | ') : String(err) });
    if (!res.headersSent) res.status(status).json(body);
  });
  return app;
}
