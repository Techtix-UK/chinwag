/**
 * OAuth 2.1 authorisation server for remote MCP clients, built on the official MCP TypeScript SDK
 * (`mcpAuthRouter`), which implements the protocol endpoints (authorize, token, register, revoke,
 * RFC 8414 / RFC 9728 metadata, PKCE S256 verification). This module supplies persistent storage,
 * the consent hand-off, token issuance with refresh-token rotation and reuse detection.
 */
import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError, AccessDeniedError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { prisma } from '../db/prisma.js';
import type { OAuthClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../lib/crypto.js';
import { logger, errMsg } from '../lib/logger.js';
import { safeFetch } from '../lib/netguard.js';
import { audit } from '../services/audit.js';
import { authenticateApiKey, looksLikeApiKey } from '../services/apiKeys.js';
import { MCP_SCOPES, type Principal } from '../services/permissions.js';
import { oauthPrincipal } from '../services/principals.js';
import { settings } from '../services/settings.js';

const log = logger('oauth');

export const ACCESS_TOKEN_TTL_S = 3600;
export const REFRESH_TOKEN_TTL_S = 30 * 86400;
export const CODE_TTL_S = 600;
export const REQUEST_TTL_S = 900;

function toClientInfo(c: OAuthClient): OAuthClientInformationFull {
  return {
    client_id: c.clientId,
    client_secret: c.clientSecretEnc ? decryptSecret(c.clientSecretEnc) : undefined,
    client_secret_expires_at: c.clientSecretExpiresAt ?? undefined,
    client_id_issued_at: Math.floor(c.createdAt.getTime() / 1000),
    redirect_uris: c.redirectUris as string[],
    grant_types: c.grantTypes as string[],
    response_types: c.responseTypes as string[],
    token_endpoint_auth_method: c.tokenEndpointAuthMethod,
    client_name: c.clientName ?? undefined,
    client_uri: c.clientUri ?? undefined,
    logo_uri: c.logoUri ?? undefined,
    scope: c.scope ?? undefined,
  } as OAuthClientInformationFull;
}

const CIMD_REFRESH_MS = 24 * 3600_000;

/**
 * Validate a Client ID Metadata Document and map it to a stored client.
 * Clients are treated as public clients protected by PKCE. A document may prefer private_key_jwt
 * (as ChatGPT's does) as long as it also lists "none" among supported methods; this server only
 * advertises "none" and "client_secret_post", so such clients authenticate as public clients.
 */
export function clientFromMetadataDocument(clientId: string, doc: any) {
  if (!doc || typeof doc !== 'object') throw new Error('Document is not a JSON object');
  if (doc.client_id !== clientId) throw new Error('client_id in document does not match its URL');
  const redirectUris: string[] = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((u: unknown) => typeof u === 'string' && URL.canParse(u) && /^https:\/\//.test(u as string)) : [];
  if (!redirectUris.length) throw new Error('Document has no https redirect_uris');
  const method = doc.token_endpoint_auth_method ?? 'none';
  const supported: unknown[] = Array.isArray(doc.token_endpoint_auth_methods_supported) ? doc.token_endpoint_auth_methods_supported : [method];
  if (method !== 'none' && !supported.includes('none')) {
    throw new Error(`Client requires ${method} authentication, which this server does not support for metadata documents`);
  }
  return {
    clientName: typeof doc.client_name === 'string' ? doc.client_name.slice(0, 250) : null,
    clientUri: typeof doc.client_uri === 'string' ? doc.client_uri.slice(0, 500) : null,
    logoUri: typeof doc.logo_uri === 'string' ? doc.logo_uri.slice(0, 500) : null,
    redirectUris,
    grantTypes: Array.isArray(doc.grant_types) ? doc.grant_types : ['authorization_code', 'refresh_token'],
    responseTypes: Array.isArray(doc.response_types) ? doc.response_types : ['code'],
    tokenEndpointAuthMethod: 'none',
    scope: typeof doc.scope === 'string' ? doc.scope.slice(0, 1000) : null,
    registrationType: 'metadata_document',
    metadata: doc,
  };
}

/** Client ID Metadata Documents: the client_id is an HTTPS URL that serves the client's metadata. */
async function resolveMetadataDocumentClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.hash || url.username) return undefined;
  const existing = await prisma().oAuthClient.findUnique({ where: { clientId } });
  if (existing && (existing.disabled || Date.now() - existing.updatedAt.getTime() < CIMD_REFRESH_MS)) {
    return existing.disabled ? undefined : toClientInfo(existing);
  }
  try {
    const res = await safeFetch(clientId, { maxBytes: 16 * 1024, timeoutMs: 8000, headers: { accept: 'application/json' } });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = clientFromMetadataDocument(clientId, JSON.parse(res.body.toString('utf8')));
    const row = await prisma().oAuthClient.upsert({ where: { clientId }, create: { clientId, ...data }, update: data });
    return toClientInfo(row);
  } catch (e) {
    log.warn('Client metadata document could not be used', { error: errMsg(e) });
    return existing && !existing.disabled ? toClientInfo(existing) : undefined;
  }
}

export const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId) {
    if (clientId.startsWith('https://')) return resolveMetadataDocumentClient(clientId);
    const c = await prisma().oAuthClient.findUnique({ where: { clientId } });
    if (!c || c.disabled) return undefined;
    return toClientInfo(c);
  },
  async registerClient(client) {
    if (!settings().allowDynamicClientRegistration) throw new InvalidClientMetadataError('Dynamic client registration is disabled by the administrator');
    const clientId = (client as any).client_id ?? 'cwc_' + randomToken(18);
    const row = await prisma().oAuthClient.create({
      data: {
        clientId,
        clientSecretEnc: client.client_secret ? encryptSecret(client.client_secret) : null,
        clientSecretExpiresAt: client.client_secret_expires_at ?? null,
        clientName: client.client_name?.slice(0, 250) ?? null,
        clientUri: client.client_uri?.slice(0, 500) ?? null,
        logoUri: client.logo_uri?.slice(0, 500) ?? null,
        redirectUris: client.redirect_uris as string[],
        grantTypes: client.grant_types ?? ['authorization_code', 'refresh_token'],
        responseTypes: client.response_types ?? ['code'],
        tokenEndpointAuthMethod: client.token_endpoint_auth_method ?? 'client_secret_post',
        scope: client.scope?.slice(0, 1000) ?? null,
        registrationType: 'dynamic',
        metadata: client as any,
      },
    });
    await audit({ action: 'oauth.client_registered', source: 'oauth', metadata: { clientId, clientName: client.client_name } });
    return toClientInfo(row);
  },
};

function resourceMatches(resource: string | URL | undefined | null): boolean {
  if (!resource) return true;
  const want = env().mcpUrl.href.replace(/\/$/, '');
  const got = new URL(String(resource));
  got.hash = '';
  const g = got.href.replace(/\/$/, '');
  return g === want || g === env().baseUrl.href.replace(/\/$/, '');
}

async function issueTokens(authorisationId: string, scopes: string[], resource: string | null, parentId: string | null): Promise<OAuthTokens> {
  const access = 'cwa_' + randomToken(32);
  const refresh = 'cwr_' + randomToken(32);
  const now = Date.now();
  await prisma().oAuthToken.createMany({
    data: [
      { authorisationId, type: 'ACCESS', tokenHash: sha256(access), scopes, resource, parentId, expiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000) },
      { authorisationId, type: 'REFRESH', tokenHash: sha256(refresh), scopes, resource, parentId, expiresAt: new Date(now + REFRESH_TOKEN_TTL_S * 1000) },
    ],
  });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_S, refresh_token: refresh, scope: scopes.join(' ') };
}

async function revokeGrant(authorisationId: string, reason: string) {
  await prisma().$transaction([
    prisma().oAuthAuthorisation.update({ where: { id: authorisationId }, data: { revokedAt: new Date(), revokedReason: reason } }),
    prisma().oAuthToken.updateMany({ where: { authorisationId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ action: 'oauth.grant_revoked', source: 'oauth', result: 'success', metadata: { authorisationId, reason } });
}

export const oauthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const requested = (params.scopes ?? []).filter(Boolean);
    const invalid = requested.filter((s) => !(MCP_SCOPES as readonly string[]).includes(s));
    if (invalid.length) throw new InvalidScopeError(`Unsupported scope(s): ${invalid.join(', ')}`);
    if (params.resource && !resourceMatches(params.resource)) throw new InvalidTargetError('Unknown resource');
    const id = randomToken(32);
    await prisma().oAuthAuthorizationRequest.create({
      data: {
        id,
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state ?? null,
        scopes: requested.length ? requested : [...MCP_SCOPES],
        resource: params.resource?.href ?? null,
        expiresAt: new Date(Date.now() + REQUEST_TTL_S * 1000),
      },
    });
    res.redirect(302, `/oauth/consent?request=${encodeURIComponent(id)}`);
  },

  async challengeForAuthorizationCode(client, authorizationCode) {
    const code = await prisma().oAuthToken.findUnique({ where: { tokenHash: sha256(authorizationCode) }, include: { authorisation: { include: { client: true } } } });
    if (!code || code.type !== 'AUTHORIZATION_CODE' || code.authorisation.client.clientId !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
    if (code.expiresAt < new Date()) throw new InvalidGrantError('Authorization code expired');
    return code.codeChallenge!;
  },

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
    const code = await prisma().oAuthToken.findUnique({ where: { tokenHash: sha256(authorizationCode) }, include: { authorisation: { include: { client: true } } } });
    if (!code || code.type !== 'AUTHORIZATION_CODE' || code.authorisation.client.clientId !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
    if (code.expiresAt < new Date() || code.revokedAt) throw new InvalidGrantError('Authorization code expired');
    if (redirectUri && code.redirectUri !== redirectUri) throw new InvalidGrantError('redirect_uri does not match');
    if (resource && !resourceMatches(resource)) throw new InvalidTargetError('Unknown resource');
    const used = await prisma().oAuthToken.updateMany({ where: { id: code.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) {
      // Authorization code replay: revoke everything issued from it.
      await revokeGrant(code.authorisationId, 'authorization_code_reuse');
      throw new InvalidGrantError('Authorization code already used');
    }
    if (code.authorisation.revokedAt) throw new InvalidGrantError('Authorization revoked');
    await audit({ action: 'oauth.token_issued', actor: { type: 'oauth', id: code.authorisationId, label: client.client_name ?? client.client_id }, source: 'oauth' });
    return issueTokens(code.authorisationId, code.scopes as string[], code.resource ?? resource?.href ?? null, code.id);
  },

  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const tok = await prisma().oAuthToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { authorisation: { include: { client: true } } } });
    if (!tok || tok.type !== 'REFRESH' || tok.authorisation.client.clientId !== client.client_id) throw new InvalidGrantError('Invalid refresh token');
    if (tok.authorisation.revokedAt) throw new InvalidGrantError('Authorization revoked');
    if (tok.usedAt || tok.revokedAt) {
      // Refresh-token reuse indicates theft: revoke the whole grant (token family).
      await revokeGrant(tok.authorisationId, 'refresh_token_reuse');
      throw new InvalidGrantError('Refresh token already used');
    }
    if (tok.expiresAt < new Date()) throw new InvalidGrantError('Refresh token expired');
    if (resource && !resourceMatches(resource)) throw new InvalidTargetError('Unknown resource');
    const granted = tok.scopes as string[];
    const narrowed = scopes?.length ? scopes : granted;
    if (narrowed.some((s) => !granted.includes(s))) throw new InvalidScopeError('Requested scope exceeds the original grant');
    const claim = await prisma().oAuthToken.updateMany({ where: { id: tok.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claim.count !== 1) {
      await revokeGrant(tok.authorisationId, 'refresh_token_reuse');
      throw new InvalidGrantError('Refresh token already used');
    }
    // Rotation: the previous access tokens from this refresh lineage are retired.
    await prisma().oAuthToken.updateMany({ where: { authorisationId: tok.authorisationId, type: 'ACCESS', revokedAt: null, expiresAt: { gt: new Date() }, parentId: tok.parentId }, data: { revokedAt: new Date() } });
    return issueTokens(tok.authorisationId, narrowed, tok.resource, tok.id);
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // API keys may also be used against /mcp (useful for testing and server-to-server clients).
    if (looksLikeApiKey(token)) {
      const p = await authenticateApiKey(token);
      if (!p) throw new InvalidTokenError('Invalid or expired API key');
      return { token, clientId: p.id, scopes: [...p.capabilities], expiresAt: Math.floor(Date.now() / 1000) + 300, extra: { principal: p } };
    }
    const tok = await prisma().oAuthToken.findUnique({ where: { tokenHash: sha256(token) }, include: { authorisation: { include: { client: true } } } });
    if (!tok || tok.type !== 'ACCESS' || tok.revokedAt || tok.expiresAt < new Date()) throw new InvalidTokenError('Invalid or expired access token');
    const grant = tok.authorisation;
    if (grant.revokedAt || grant.client.disabled) throw new InvalidTokenError('Access has been revoked');
    if (tok.resource && !resourceMatches(tok.resource)) throw new InvalidTokenError('Token was issued for a different resource');
    const principal = await oauthPrincipal({ ...grant, scopes: tok.scopes, client: grant.client });
    if (!principal) throw new InvalidTokenError('The authorising user is no longer active');
    if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > 30_000) {
      await prisma().oAuthAuthorisation.update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }
    return {
      token,
      clientId: grant.client.clientId,
      scopes: [...principal.capabilities],
      expiresAt: Math.floor(tok.expiresAt.getTime() / 1000),
      resource: tok.resource ? new URL(tok.resource) : undefined,
      extra: { principal },
    };
  },

  async revokeToken(client, request: OAuthTokenRevocationRequest) {
    const tok = await prisma().oAuthToken.findUnique({ where: { tokenHash: sha256(request.token) }, include: { authorisation: { include: { client: true } } } });
    if (!tok || tok.authorisation.client.clientId !== client.client_id) return;
    if (tok.type === 'REFRESH') await revokeGrant(tok.authorisationId, 'revoked_by_client');
    else await prisma().oAuthToken.update({ where: { id: tok.id }, data: { revokedAt: new Date() } });
  },
};

// ───────────── consent hand-off (called from the dashboard consent screen) ─────────────

export async function loadRequest(id: string) {
  const req = await prisma().oAuthAuthorizationRequest.findUnique({ where: { id } });
  if (!req || req.consumedAt || req.expiresAt < new Date()) return null;
  const client = await clientsStore.getClient(req.clientId);
  if (!client) return null;
  return { req, client };
}

export async function completeConsent(
  principal: Principal,
  id: string,
  decision: { approve: boolean; scopes: string[]; accountIds: string[]; approvalPolicy: 'READ_ONLY' | 'REQUIRE_APPROVAL' | 'CONFIRM_IN_CHAT' | 'CONFIRM_IN_CHAT_OR_DASHBOARD' | 'DIRECT' },
): Promise<string> {
  const loaded = await loadRequest(id);
  if (!loaded) throw new AccessDeniedError('Authorization request expired or not found');
  const { req, client } = loaded;
  const claim = await prisma().oAuthAuthorizationRequest.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date(), userId: principal.id } });
  if (claim.count !== 1) throw new AccessDeniedError('Authorization request already used');
  const redirect = new URL(req.redirectUri);
  if (req.state) redirect.searchParams.set('state', req.state);
  if (!decision.approve) {
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', 'The user denied access');
    await audit({ action: 'oauth.consent_denied', actor: principal, source: 'oauth', metadata: { clientId: client.client_id } });
    return redirect.toString();
  }
  const requested = req.scopes as string[];
  const scopes = decision.scopes.filter((s) => requested.includes(s));
  if (!scopes.length) throw new InvalidScopeError('No scopes granted');
  const dbClient = await prisma().oAuthClient.findUniqueOrThrow({ where: { clientId: client.client_id } });
  const grant = await prisma().oAuthAuthorisation.create({
    data: { clientDbId: dbClient.id, userId: principal.id, scopes, accountIds: decision.accountIds, approvalPolicy: decision.approvalPolicy },
  });
  const code = randomToken(32);
  await prisma().oAuthToken.create({
    data: {
      authorisationId: grant.id,
      type: 'AUTHORIZATION_CODE',
      tokenHash: sha256(code),
      scopes,
      resource: req.resource,
      codeChallenge: req.codeChallenge,
      redirectUri: req.redirectUri,
      expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
    },
  });
  await audit({ action: 'oauth.consent_granted', actor: principal, source: 'oauth', metadata: { clientId: client.client_id, clientName: client.client_name, scopes, accounts: decision.accountIds.length, policy: decision.approvalPolicy } });
  redirect.searchParams.set('code', code);
  return redirect.toString();
}

export { revokeGrant };
