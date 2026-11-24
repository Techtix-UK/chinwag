import type { Request, Response, NextFunction, Router, RequestHandler } from 'express';
import { z } from 'zod';
import { AppError, forbidden, unauthorized, validationError } from '../lib/errors.js';
import type { Principal, Capability } from '../services/permissions.js';
import { can } from '../services/permissions.js';

export type AuthMode = 'principal' | 'session' | 'session-any' | 'public';

export interface RouteDef<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  /** principal: session or API key (default). session: dashboard users only. session-any: logged-in users without dashboard access. */
  auth?: AuthMode;
  /** Global capability required before the handler runs (account-level checks happen in services). */
  capability?: Capability;
  params?: P;
  query?: Q;
  body?: B;
  idempotent?: boolean;
  internal?: boolean;
  status?: number;
  middleware?: RequestHandler[];
  handler: (ctx: { req: Request; res: Response; principal: Principal; params: z.infer<P>; query: z.infer<Q>; body: z.infer<B> }) => Promise<unknown>;
}

export class Envelope {
  constructor(public data: unknown, public meta?: Record<string, unknown>) {}
}
export const page = (items: unknown[], total: number, limit: number, offset: number) =>
  new Envelope(items, { pagination: { total, limit, offset, has_more: offset + items.length < total } });

export const registry: RouteDef<any, any, any>[] = [];

function parse<T extends z.ZodType>(schema: T | undefined, value: unknown, where: string): any {
  if (!schema) return value ?? {};
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw validationError(`Invalid ${where}`, r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function route<P extends z.ZodType = z.ZodObject<{}>, Q extends z.ZodType = z.ZodObject<{}>, B extends z.ZodType = z.ZodObject<{}>>(router: Router, def: RouteDef<P, Q, B>, mountPrefix = '/api/v1') {
  registry.push({ ...def, path: mountPrefix + def.path } as any);
  const handler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = def.auth ?? 'principal';
      const principal = req.principal;
      if (auth !== 'public') {
        if (!principal) throw unauthorized();
        if ((auth === 'session' || auth === 'session-any') && principal.type !== 'user') throw forbidden('This endpoint is only available to dashboard users');
        if (principal.type === 'user' && auth !== 'session-any' && !can(principal, 'dashboard:access')) throw forbidden('Your role does not include dashboard access');
        if (def.capability && !can(principal, def.capability)) throw forbidden(`Missing permission ${def.capability}`);
      }
      const params = parse(def.params, req.params, 'path parameters');
      const query = parse(def.query, req.query, 'query parameters');
      const body = parse(def.body, req.body, 'request body');
      const result = await def.handler({ req, res, principal: principal!, params, query, body });
      if (res.headersSent || res.locals.streaming) return;
      if (result === undefined) {
        res.status(def.status ?? 204).end();
        return;
      }
      if (result instanceof Envelope) res.status(def.status ?? 200).json({ data: result.data, ...(result.meta ? { meta: result.meta } : {}) });
      else res.status(def.status ?? 200).json({ data: result });
    } catch (e) {
      next(e);
    }
  };
  (router as any)[def.method](def.path, ...(def.middleware ?? []), handler);
}

export const pagination = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
};

export function errorBody(e: unknown) {
  if (e instanceof AppError) return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } } };
  return { status: 500, body: { error: { code: 'internal_error', message: 'An unexpected error occurred' } } };
}
