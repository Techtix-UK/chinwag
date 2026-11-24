/** Fetch wrapper for the REST API: session cookie + CSRF header, uniform error handling. */
let csrfToken: string | null = null;
export function setCsrf(token: string | null | undefined) {
  csrfToken = token ?? null;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

export interface Paged<T> {
  data: T[];
  meta?: { pagination?: { total: number; limit: number; offset: number; has_more: boolean } };
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch('/api/v1' + path, { method, headers, body: payload, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error ?? {};
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/setup')) window.dispatchEvent(new CustomEvent('ttw:unauthorized'));
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? `Request failed (${res.status})`, err.details);
  }
  return (opts.raw ? json : json?.data) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  page: <T>(path: string) => request<Paged<T>>('GET', path, undefined, { raw: true }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body ?? {}, { headers }),
  postRaw: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body ?? {}, { raw: true, headers }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? '?' + out : '';
}

export function idempotencyKey() {
  return crypto.randomUUID();
}
