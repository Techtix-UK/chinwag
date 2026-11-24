import type { Express, Request, Response } from 'express';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { env } from '../config/env.js';
import { errMsg, logger } from '../lib/logger.js';
import { oauthProvider } from '../oauth/provider.js';
import type { Principal } from '../services/permissions.js';
import { buildMcpServer } from './server.js';

const log = logger('mcp');

export function mountMcp(app: Express) {
  const auth = requireBearerAuth({
    verifier: oauthProvider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(env().mcpUrl),
  });

  app.post('/mcp', express.json({ limit: '150mb' }), auth, async (req: Request, res: Response) => {
    const principal = (req.auth?.extra as { principal?: Principal } | undefined)?.principal;
    if (!principal) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    principal.ip = req.ip;
    const server = buildMcpServer(principal);
    // Stateless Streamable HTTP: one transport per request, no server-side session affinity required.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      log.error('MCP request failed', { error: errMsg(e) });
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });

  const notAllowed = (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server uses stateless Streamable HTTP (POST only).' }, id: null });
  };
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
