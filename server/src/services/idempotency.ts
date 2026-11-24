import { prisma } from '../db/prisma.js';
import { canonicalJson, sha256 } from '../lib/crypto.js';
import { AppError, conflict } from '../lib/errors.js';

/**
 * Idempotency for outbound operations. The same key with the same request replays the stored
 * response; the same key with a different request is rejected; an in-flight key returns 409.
 */
export async function withIdempotency<T>(principalKey: string, key: string | undefined, request: unknown, fn: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T; replayed: boolean }> {
  if (!key) return { ...(await fn()), replayed: false };
  if (key.length > 190 || !/^[\w.:-]+$/.test(key)) throw new AppError(400, 'invalid_idempotency_key', 'Idempotency-Key must be 1–190 characters of [A-Za-z0-9_.:-]');
  const requestHash = sha256(canonicalJson(request));
  try {
    await prisma().idempotencyKey.create({ data: { principal: principalKey.slice(0, 96), key, requestHash, state: 'IN_PROGRESS' } });
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e;
    const existing = await prisma().idempotencyKey.findUnique({ where: { principal_key: { principal: principalKey.slice(0, 96), key } } });
    if (!existing) throw e;
    if (existing.requestHash !== requestHash) throw new AppError(422, 'idempotency_key_reused', 'Idempotency-Key was already used with a different request');
    if (existing.state === 'IN_PROGRESS') throw conflict('A request with this Idempotency-Key is still in progress');
    return { status: existing.statusCode ?? 200, body: existing.response as T, replayed: true };
  }
  try {
    const res = await fn();
    await prisma().idempotencyKey.update({ where: { principal_key: { principal: principalKey.slice(0, 96), key } }, data: { state: 'COMPLETE', statusCode: res.status, response: res.body as any } });
    return { ...res, replayed: false };
  } catch (e) {
    // Errors are recorded so a retry with the same key does not re-execute a possibly-sent message.
    const status = e instanceof AppError ? e.status : 500;
    const body = { error: { code: e instanceof AppError ? e.code : 'internal_error', message: e instanceof Error ? e.message : 'Error', details: e instanceof AppError ? e.details : undefined } };
    const retryable = e instanceof AppError && (e.status === 503 || e.status === 422 || e.status === 404 || e.status === 403 || e.code === 'ambiguous_recipient');
    if (retryable) await prisma().idempotencyKey.delete({ where: { principal_key: { principal: principalKey.slice(0, 96), key } } }).catch(() => {});
    else await prisma().idempotencyKey.update({ where: { principal_key: { principal: principalKey.slice(0, 96), key } }, data: { state: 'COMPLETE', statusCode: status, response: body as any } }).catch(() => {});
    throw e;
  }
}
