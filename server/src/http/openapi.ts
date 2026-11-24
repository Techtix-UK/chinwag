import { z } from 'zod';
import { registry } from './route.js';
import { env } from '../config/env.js';
import { DATA_SCOPES, SCOPE_DESCRIPTIONS } from '../services/permissions.js';

function toSchema(s: z.ZodType | undefined) {
  if (!s) return undefined;
  try {
    const js = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, any>;
    delete js.$schema;
    return js;
  } catch {
    return { type: 'object' };
  }
}

/** Builds the OpenAPI 3.1 document from the same route definitions (and Zod schemas) that validate requests. */
export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of registry) {
    if (r.internal) continue;
    const path = r.path.replace(/:(\w+)/g, '{$1}');
    const params: unknown[] = [];
    const ps = toSchema(r.params);
    for (const [name, schema] of Object.entries(ps?.properties ?? {})) params.push({ name, in: 'path', required: true, schema });
    const qs = toSchema(r.query);
    for (const [name, schema] of Object.entries(qs?.properties ?? {})) params.push({ name, in: 'query', required: (qs?.required ?? []).includes(name), schema });
    if (r.idempotent) params.push({ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 190 }, description: 'Repeat-safe key. Reusing it with the same request replays the original response and never sends twice.' });
    const body = toSchema(r.body);
    const op: Record<string, unknown> = {
      summary: r.summary,
      ...(r.description ? { description: r.description } : {}),
      tags: r.tags,
      parameters: params,
      ...(body && Object.keys(body.properties ?? {}).length ? { requestBody: { required: true, content: { 'application/json': { schema: body }, ...(r.path.endsWith('/media') || r.path.endsWith('/attachments') ? { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, ...(body.properties ?? {}) } } } } : {}) } } } : {}),
      responses: {
        [String(r.status ?? (r.method === 'delete' ? 204 : 200))]: { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } },
        ...(r.path.includes('/messages/') && r.method === 'post' ? { 202: { description: 'Queued for approval — NOT sent' }, 409: { description: 'Ambiguous recipient — candidates returned' } } : {}),
        400: { $ref: '#/components/responses/Error' },
        401: { $ref: '#/components/responses/Error' },
        403: { $ref: '#/components/responses/Error' },
        404: { $ref: '#/components/responses/Error' },
        422: { $ref: '#/components/responses/Error' },
        429: { $ref: '#/components/responses/Error' },
        503: { description: 'WhatsApp account not connected', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
      security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    };
    paths[path] = { ...(paths[path] ?? {}), [r.method]: op };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Chinwag API',
      version: '1.0.0',
      description:
        'REST API for Chinwag by Techtix Global. Uses WhatsApp Web linked-device sessions via the unofficial whatsapp-web.js library — not affiliated with WhatsApp or Meta.\n\n' +
        'Authenticate with `Authorization: Bearer cwk_…` API keys. Scopes:\n' + DATA_SCOPES.map((s) => `- \`${s}\` — ${SCOPE_DESCRIPTIONS[s]}`).join('\n') +
        '\n\nResponses use `{ "data": … , "meta": { "pagination": … } }`; errors use `{ "error": { "code", "message", "details" } }`.',
    },
    servers: [{ url: new URL('/', env().baseUrl).toString().replace(/\/$/, '') }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'API key created under API Credentials' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'chinwag_session', description: 'Dashboard session (requires X-CSRF-Token for writes)' },
      },
      schemas: {
        Envelope: { type: 'object', properties: { data: {}, meta: { type: 'object' } } },
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} }, required: ['code', 'message'] } } },
      },
      responses: { Error: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
    },
  };
}
