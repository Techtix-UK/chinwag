import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { AppError, forbidden, notFound, validationError } from '../../lib/errors.js';
import { createApiKey, revokeApiKey, rotateApiKey, serializeApiKey } from '../../services/apiKeys.js';
import { audit } from '../../services/audit.js';
import { MCP_SCOPES, SCOPE_DESCRIPTIONS, accountsWith, can, DATA_SCOPES } from '../../services/permissions.js';
import { settings } from '../../services/settings.js';
import { completeConsent, loadRequest, revokeGrant } from '../../oauth/provider.js';
import { MCP_TOOL_NAMES } from '../../mcp/server.js';
import { route } from '../route.js';

const policy = z.enum(['READ_ONLY', 'REQUIRE_APPROVAL', 'DIRECT']);
const idParam = z.object({ id: z.string().min(1).max(64) });

export function integrationRoutes(r: Router) {
  // ───────────── API keys ─────────────
  route(r, {
    method: 'get', path: '/api-keys', summary: 'List API keys', tags: ['API credentials'], auth: 'session', capability: 'integrations:manage', internal: true,
    handler: async () => (await prisma().apiKey.findMany({ orderBy: { createdAt: 'desc' } })).map(serializeApiKey),
  });

  route(r, {
    method: 'post', path: '/api-keys', summary: 'Create an API key (the secret is shown once)', tags: ['API credentials'], auth: 'session', capability: 'integrations:manage', internal: true, status: 201,
    body: z.object({
      name: z.string().min(1).max(128),
      scopes: z.array(z.enum(DATA_SCOPES)).min(1),
      account_ids: z.array(z.string().max(40)).default([]),
      all_accounts: z.boolean().default(false),
      approval_policy: policy.default('REQUIRE_APPROVAL'),
      expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
    }),
    handler: async ({ principal, body }) => {
      if (!body.all_accounts && !body.account_ids.length) throw validationError('Select at least one account or all accounts');
      const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
      if (expiresAt && expiresAt < new Date()) throw validationError('Expiry must be in the future');
      const { key, secret } = await createApiKey(principal, { name: body.name, scopes: body.scopes, accountIds: body.all_accounts ? [] : body.account_ids, allAccounts: body.all_accounts, approvalPolicy: body.approval_policy, expiresAt });
      return { ...serializeApiKey(key), secret };
    },
  });

  route(r, {
    method: 'post', path: '/api-keys/:id/rotate', summary: 'Rotate an API key', tags: ['API credentials'], auth: 'session', capability: 'integrations:manage', internal: true, params: idParam,
    handler: async ({ principal, params }) => {
      const { key, secret } = await rotateApiKey(principal, params.id);
      return { ...serializeApiKey(key), secret };
    },
  });

  route(r, {
    method: 'delete', path: '/api-keys/:id', summary: 'Revoke an API key immediately', tags: ['API credentials'], auth: 'session', capability: 'integrations:manage', internal: true, params: idParam,
    handler: async ({ principal, params }) => serializeApiKey(await revokeApiKey(principal, params.id)),
  });

  // ───────────── MCP / OAuth clients ─────────────
  route(r, {
    method: 'get', path: '/mcp/overview', summary: 'MCP integration status', tags: ['MCP'], auth: 'session', capability: 'integrations:manage', internal: true,
    handler: async () => {
      const [clients, grants, recent] = await Promise.all([
        prisma().oAuthClient.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { authorisations: true } } } }),
        prisma().oAuthAuthorisation.findMany({ orderBy: { createdAt: 'desc' }, include: { client: true, user: { select: { id: true, email: true, name: true } } } }),
        prisma().auditLog.findMany({ where: { source: 'mcp', action: { startsWith: 'mcp.' } }, orderBy: { timestamp: 'desc' }, take: 50 }),
      ]);
      const lastOk = await prisma().auditLog.findFirst({ where: { source: 'mcp', action: { startsWith: 'mcp.' }, result: 'success' }, orderBy: { timestamp: 'desc' } });
      const errors = await prisma().auditLog.findMany({ where: { source: { in: ['mcp', 'oauth'] }, result: { in: ['failure', 'denied'] } }, orderBy: { timestamp: 'desc' }, take: 20 });
      const accounts = await prisma().whatsappAccount.findMany({ select: { id: true, displayName: true } });
      const accName = new Map(accounts.map((a) => [a.id, a.displayName]));
      return {
        server_url: env().mcpUrl.toString(),
        protected_resource_metadata: new URL('/.well-known/oauth-protected-resource/mcp', env().baseUrl).toString(),
        authorization_server_metadata: new URL('/.well-known/oauth-authorization-server', env().baseUrl).toString(),
        transport: 'streamable-http',
        authentication: 'OAuth 2.1 (authorization code + PKCE S256), dynamic client registration ' + (settings().allowDynamicClientRegistration ? 'enabled' : 'disabled'),
        scopes: MCP_SCOPES.map((s) => ({ scope: s, description: SCOPE_DESCRIPTIONS[s] })),
        tools: MCP_TOOL_NAMES,
        last_successful_request: lastOk?.timestamp ?? null,
        clients: clients.map((c) => ({ id: c.id, client_id: c.clientId, name: c.clientName, client_uri: c.clientUri, registration_type: c.registrationType, redirect_uris: c.redirectUris, disabled: c.disabled, created_at: c.createdAt, authorisations: c._count.authorisations })),
        connections: grants.map((g) => ({
          id: g.id,
          client: { id: g.client.id, name: g.client.clientName ?? g.client.clientId },
          user: g.user,
          scopes: g.scopes,
          accounts: (g.accountIds as string[]).map((id) => ({ id, name: accName.get(id) ?? '(removed)' })),
          approval_policy: g.approvalPolicy.toLowerCase(),
          last_used_at: g.lastUsedAt,
          last_error: g.lastError,
          last_error_at: g.lastErrorAt,
          revoked_at: g.revokedAt,
          revoked_reason: g.revokedReason,
          created_at: g.createdAt,
          status: g.revokedAt ? 'revoked' : 'active',
        })),
        recent_activity: recent.map((a) => ({ timestamp: a.timestamp, tool: a.action.replace(/^mcp\./, ''), actor: a.actorLabel, account_id: a.accountId, result: a.result })),
        errors: errors.map((a) => ({ timestamp: a.timestamp, action: a.action, actor: a.actorLabel, result: a.result, metadata: a.metadata })),
      };
    },
  });

  route(r, {
    method: 'post', path: '/mcp/connections/:id/revoke', summary: 'Revoke an MCP client connection immediately', tags: ['MCP'], auth: 'session', capability: 'integrations:manage', internal: true, params: idParam,
    handler: async ({ principal, params }) => {
      const g = await prisma().oAuthAuthorisation.findUnique({ where: { id: params.id } });
      if (!g) throw notFound('Connection');
      await revokeGrant(g.id, 'revoked_by_administrator');
      await audit({ action: 'oauth.connection_revoked', actor: principal, metadata: { authorisationId: g.id } });
      return { ok: true };
    },
  });

  route(r, {
    method: 'patch', path: '/mcp/connections/:id', summary: 'Change a connection approval policy or accounts', tags: ['MCP'], auth: 'session', capability: 'integrations:manage', internal: true, params: idParam,
    body: z.object({ approval_policy: policy.optional(), account_ids: z.array(z.string().max(40)).optional() }),
    handler: async ({ principal, params, body }) => {
      const g = await prisma().oAuthAuthorisation.findUnique({ where: { id: params.id } });
      if (!g || g.revokedAt) throw notFound('Active connection');
      if (body.account_ids) for (const a of body.account_ids) if (!can(principal, 'accounts:read', a)) throw forbidden('You can only grant accounts you can access');
      await prisma().oAuthAuthorisation.update({ where: { id: g.id }, data: { ...(body.approval_policy ? { approvalPolicy: body.approval_policy } : {}), ...(body.account_ids ? { accountIds: body.account_ids } : {}) } });
      await audit({ action: 'oauth.connection_updated', actor: principal, metadata: { authorisationId: g.id, policy: body.approval_policy } });
      return { ok: true };
    },
  });

  route(r, {
    method: 'post', path: '/mcp/clients/:id/disable', summary: 'Disable an OAuth client and revoke all its connections', tags: ['MCP'], auth: 'session', capability: 'integrations:manage', internal: true, params: idParam,
    body: z.object({ disabled: z.boolean() }),
    handler: async ({ principal, params, body }) => {
      const c = await prisma().oAuthClient.update({ where: { id: params.id }, data: { disabled: body.disabled } });
      if (body.disabled) {
        const grants = await prisma().oAuthAuthorisation.findMany({ where: { clientDbId: c.id, revokedAt: null } });
        for (const g of grants) await revokeGrant(g.id, 'client_disabled');
      }
      await audit({ action: body.disabled ? 'oauth.client_disabled' : 'oauth.client_enabled', actor: principal, metadata: { clientId: c.clientId } });
      return { ok: true };
    },
  });

  route(r, {
    method: 'post', path: '/mcp/test', summary: 'Test the MCP endpoint end-to-end', tags: ['MCP'], auth: 'session', capability: 'integrations:manage', internal: true,
    handler: async ({ principal }) => {
      // Calls the public metadata endpoints and performs an unauthenticated initialize, which must be rejected with 401.
      const base = `http://${env().HOST === '0.0.0.0' ? '127.0.0.1' : env().HOST}:${env().PORT}`;
      const results: { check: string; ok: boolean; detail: string }[] = [];
      const check = async (name: string, fn: () => Promise<string>) => {
        try {
          results.push({ check: name, ok: true, detail: await fn() });
        } catch (e) {
          results.push({ check: name, ok: false, detail: e instanceof Error ? e.message : String(e) });
        }
      };
      await check('Protected resource metadata', async () => {
        const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j: any = await res.json();
        return `resource=${j.resource}`;
      });
      await check('Authorization server metadata', async () => {
        const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j: any = await res.json();
        if (!j.code_challenge_methods_supported?.includes('S256')) throw new Error('S256 not advertised');
        return `issuer=${j.issuer}`;
      });
      await check('Unauthenticated requests are rejected', async () => {
        const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'self-test', version: '1' } } }) });
        if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
        return `401 with ${res.headers.get('www-authenticate')?.slice(0, 80) ?? 'no'} challenge`;
      });
      const okAll = results.every((r) => r.ok);
      await audit({ action: 'mcp.self_test', actor: principal, result: okAll ? 'success' : 'failure' });
      return { ok: okAll, results, note: 'Public reachability from ChatGPT also requires valid HTTPS at ' + env().mcpUrl.toString() };
    },
  });

  // ───────────── OAuth consent (dashboard session; no dashboard role needed) ─────────────
  route(r, {
    method: 'get', path: '/oauth/requests/:id', summary: 'Consent screen data', tags: ['OAuth'], auth: 'session-any', internal: true, params: z.object({ id: z.string().min(20).max(64) }),
    handler: async ({ principal, params }) => {
      const loaded = await loadRequest(params.id);
      if (!loaded) throw new AppError(404, 'request_expired', 'This authorisation request has expired. Start the connection again from your MCP client.');
      const { req, client } = loaded;
      const accountIds = accountsWith(principal, 'accounts:read');
      const accounts = await prisma().whatsappAccount.findMany({ where: accountIds === 'all' ? {} : { id: { in: accountIds } }, select: { id: true, displayName: true, phoneNumber: true, status: true } });
      const requested = (req.scopes as string[]).filter((s) => can(principal, s as any));
      return {
        client: { client_id: client.client_id, name: client.client_name ?? 'Unnamed client', client_uri: client.client_uri ?? null, logo_uri: client.logo_uri ?? null, redirect_host: new URL(req.redirectUri).host },
        requested_scopes: (req.scopes as string[]).map((s) => ({ scope: s, description: SCOPE_DESCRIPTIONS[s as keyof typeof SCOPE_DESCRIPTIONS] ?? s, grantable: requested.includes(s) })),
        accounts: accounts.map((a) => ({ id: a.id, display_name: a.displayName, phone_number: a.phoneNumber ? '+' + a.phoneNumber : null, status: a.status.toLowerCase() })),
        approval_policies: can(principal, 'integrations:manage') ? ['REQUIRE_APPROVAL', 'READ_ONLY', 'DIRECT'] : ['REQUIRE_APPROVAL', 'READ_ONLY'],
        default_policy: settings().defaultApprovalPolicy === 'DIRECT' && !can(principal, 'integrations:manage') ? 'REQUIRE_APPROVAL' : settings().defaultApprovalPolicy,
        expires_at: req.expiresAt,
      };
    },
  });

  route(r, {
    method: 'post', path: '/oauth/requests/:id/decision', summary: 'Approve or deny an MCP client', tags: ['OAuth'], auth: 'session-any', internal: true, params: z.object({ id: z.string().min(20).max(64) }),
    body: z.object({ approve: z.boolean(), scopes: z.array(z.enum(MCP_SCOPES)).default([]), account_ids: z.array(z.string().max(40)).default([]), approval_policy: policy.default('REQUIRE_APPROVAL') }),
    handler: async ({ principal, params, body }) => {
      if (body.approve) {
        if (!body.account_ids.length) throw validationError('Select at least one WhatsApp account');
        for (const a of body.account_ids) if (!can(principal, 'accounts:read', a)) throw forbidden('You can only grant accounts you can access');
        for (const s of body.scopes) if (!can(principal, s)) throw forbidden(`You cannot grant ${s}`);
        if (body.approval_policy === 'DIRECT' && !can(principal, 'integrations:manage')) throw forbidden('Direct sending can only be granted by integration administrators');
      }
      try {
        const redirect = await completeConsent(principal, params.id, { approve: body.approve, scopes: body.scopes, accountIds: body.account_ids, approvalPolicy: body.approval_policy });
        return { redirect_url: redirect };
      } catch (e: any) {
        if (e?.errorCode) throw new AppError(400, e.errorCode, e.message);
        throw e;
      }
    },
  });
}
