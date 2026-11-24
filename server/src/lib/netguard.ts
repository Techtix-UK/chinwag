/**
 * Outbound HTTP with server-side request forgery protection.
 * - Only http/https.
 * - DNS is resolved and every resolved address is checked against reserved ranges;
 *   the validated address is pinned for the connection (prevents DNS rebinding).
 * - Redirects are followed manually and re-validated.
 * - Response size and time limits are enforced.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { env } from '../config/env.js';

const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ['255.255.255.255', 32],
] as const;
const BLOCKED_V6 = [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32],
  ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const;

function buildBlockList() {
  const bl = new net.BlockList();
  for (const [a, p] of BLOCKED_V4) bl.addSubnet(a, p, 'ipv4');
  for (const [a, p] of BLOCKED_V6) bl.addSubnet(a, p, 'ipv6');
  return bl;
}
const blocked = buildBlockList();

function allowList(): net.BlockList | null {
  const raw = env().WEBHOOK_ALLOWED_PRIVATE_CIDRS.trim();
  if (!raw) return null;
  const bl = new net.BlockList();
  for (const cidr of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [addr, prefix] = cidr.split('/');
    const fam = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
    bl.addSubnet(addr, Number(prefix ?? (fam === 'ipv6' ? 128 : 32)), fam);
  }
  return bl;
}

export function isAddressAllowed(ip: string, allowPrivate = false): boolean {
  const fam = net.isIPv6(ip) ? 'ipv6' : net.isIPv4(ip) ? 'ipv4' : null;
  if (!fam) return false;
  // IPv4-mapped IPv6 → check the embedded IPv4 address
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isAddressAllowed(mapped[1], allowPrivate);
  if (!blocked.check(ip, fam)) return true;
  if (!allowPrivate) return false;
  const allow = allowList();
  return !!allow && allow.check(ip, fam);
}

export class BlockedDestinationError extends Error {}

export async function validateUrl(raw: string, opts: { allowPrivate?: boolean } = {}): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedDestinationError('Invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedDestinationError('Only http and https URLs are allowed');
  if (url.username || url.password) throw new BlockedDestinationError('URLs with embedded credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: { address: string; family: number }[];
  if (net.isIP(host)) addresses = [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  else {
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new BlockedDestinationError(`Could not resolve host ${host}`);
    }
  }
  if (!addresses.length) throw new BlockedDestinationError('Host did not resolve');
  for (const a of addresses) {
    if (!isAddressAllowed(a.address, opts.allowPrivate)) {
      throw new BlockedDestinationError('Destination address is in a restricted network range');
    }
  }
  return { url, address: addresses[0].address, family: addresses[0].family as 4 | 6 };
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | Buffer;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowPrivate?: boolean;
}

export interface SafeFetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const { url, address, family } = await validateUrl(current, { allowPrivate: opts.allowPrivate });
    const res = await requestOnce(url, address, family, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.location && (opts.method ?? 'GET') === 'GET') {
      current = new URL(res.headers.location, url).toString();
      continue;
    }
    return { ...res, finalUrl: url.toString() };
  }
  throw new BlockedDestinationError('Too many redirects');
}

function requestOnce(url: URL, address: string, family: 4 | 6, opts: SafeFetchOptions): Promise<Omit<SafeFetchResult, 'finalUrl'>> {
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: opts.method ?? 'GET',
        headers: { 'user-agent': 'Chinwag/1.0', ...(opts.headers ?? {}) },
        // Pin the validated address to defeat DNS rebinding.
        lookup: (_h: string, o: any, cb: any) => {
          if (o && o.all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        },
        timeout: timeoutMs,
      },
      (res) => {
        const len = Number(res.headers['content-length'] ?? 0);
        if (len && len > maxBytes) {
          res.destroy();
          reject(new Error(`Response exceeds the ${maxBytes} byte limit`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            res.destroy();
            reject(new Error(`Response exceeds the ${maxBytes} byte limit`));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
