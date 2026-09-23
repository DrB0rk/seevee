/**
 * SSRF protection helpers.
 *
 * Per `.dev/specs/DEVELOPMENT_PLAN.md` §14, the URL extractor must reject
 * destinations that resolve to private networks before issuing a fetch.
 * Adapters MUST call `isPrivateUrl` for any user-provided URL.
 */

import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { URL } from 'node:url';

/** Pair of IPv4 CIDR mask and the prefix value ANDed under that mask. A
 *  single `(n & mask) === prefix` check identifies membership in the block. */
const IPV4_RANGES = [
  { mask: 0xff000000, prefix: 0x7f000000 }, // 127.0.0.0/8  — loopback
  { mask: 0xff000000, prefix: 0x0a000000 }, // 10.0.0.0/8   — RFC 1918
  { mask: 0xffff0000, prefix: 0xc0a80000 }, // 192.168.0.0/16 — RFC 1918
  { mask: 0xfff00000, prefix: 0xac100000 }, // 172.16.0.0/12  — RFC 1918
  { mask: 0xffff0000, prefix: 0xa9fe0000 }, // 169.254.0.0/16 — link-local
  { mask: 0xf0000000, prefix: 0xe0000000 }, // 224.0.0.0/4    — multicast
  { mask: 0xf0000000, prefix: 0xf0000000 }, // 240.0.0.0/4    — reserved
] as const;

/** Address returned by `node:dns/promises` `lookup(..., {all:true})`. */
export interface DnsAddress {
  address: string;
  family: number;
}

/** Parse a strict dotted-quad IPv4 into a 32-bit unsigned integer. Returns
 *  `null` for anything that is not exactly four 0-255 decimal segments. */
export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    // Bitwise shift+or stays in 32-bit integer space; arithmetic multiply can
    // overflow into negative numbers, which would break the range masks.
    acc = ((acc << 8) | n) >>> 0;
  }
  return acc;
}

/** True if the IPv4 literal belongs to a private / loopback / reserved range. */
export function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  // 0.0.0.0/8 — anything starting with 0. is unroutable ("this network").
  if ((n >>> 24) === 0) return true;
  // Bitwise AND is signed-32 in JavaScript; force unsigned via `>>> 0` so the
  // equality comparison matches the unsigned `prefix` constants above.
  for (const { mask, prefix } of IPV4_RANGES) {
    if ((n & mask) >>> 0 === prefix) return true;
  }
  return false;
}

/** True if the IPv6 literal is loopback, link-local, ULA, or an IPv4-mapped
 *  private address. Bracketed form (`[::1]`) is normalised before checking. */
export function isPrivateIpv6(ip: string): boolean {
  const clean = (ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip)
    .toLowerCase()
    .split('%')[0] ?? '';
  if (clean === '::1' || clean === '::') return true;
  const mapped = /^::ffff:([0-9.]+)$/.exec(clean);
  if (mapped && mapped[1]) return isPrivateIpv4(mapped[1]);
  if (/^fe[89ab][0-9a-f]?:/i.test(clean)) return true; // fe80::/10 link-local
  if (/^fe[c-f][0-9a-f]?:/i.test(clean)) return true;  // fec0::/10 site-local (deprecated)
  if (/^f[cd][0-9a-f]{2}:/i.test(clean)) return true;   // fc00::/7  ULA
  return false;
}

/** True if `host` is an IP literal that should not be fetched from. */
export function isPrivateIpLiteral(host: string): boolean {
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (net.isIP(h) === 4) return isPrivateIpv4(h);
  if (net.isIP(h) === 6) return isPrivateIpv6(h);
  return false;
}

/** True if `host` looks like a loopback / local name (`localhost`, `.local`). */
export function isLocalhostName(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === 'localhost'
    || lower.endsWith('.localhost')
    || lower.endsWith('.local');
}

/**
 * Cheap synchronous host check (literal IP + name-based loopback).
 *
 * Use this before issuing a fetch to short-circuit on obvious private
 * destinations. For hostnames that need DNS resolution, use `assertUrlSafe`
 * which performs the lookup and fails closed on error.
 */
export function isPrivateHost(host: string): boolean {
  if (!host) return true;
  return isPrivateIpLiteral(host) || isLocalhostName(host);
}

/** Synchronously check a URL string against the static rules. Does NOT
 *  resolve DNS — call `assertUrlSafe` for the full check. */
export function isPrivateUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Malformed URLs are treated as unsafe.
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  return isPrivateHost(parsed.hostname);
}

/**
 * Full check including DNS resolution. Resolves the hostname to all A/AAAA
 * records and returns true ONLY when the URL parses safely AND every resolved
 * address is public. Lookup errors (NXDOMAIN, refused) fail closed.
 */
export async function assertUrlSafe(rawUrl: string): Promise<boolean> {
  if (isPrivateUrl(rawUrl)) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const hostname = parsed.hostname;
  if (isPrivateIpLiteral(hostname)) return false;

  try {
    const results = await lookup(hostname, { all: true, verbatim: true });
    for (const r of results) {
      if (net.isIP(r.address) === 4 && isPrivateIpv4(r.address)) return false;
      if (net.isIP(r.address) === 6 && isPrivateIpv6(r.address)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Outcome of `resolveAndCheck` for callers that want the resolved literals. */
export type ResolveCheckResult =
  | { ok: true; addresses: ReadonlyArray<DnsAddress> }
  | { ok: false; reason: string };

/** Resolve a URL with full DNS+IP classification. Returns `{ok:false}` for any
 *  static rule violation, invalid URL, or DNS resolution to a private
 *  address. Returns the resolved addresses on success. */
export async function resolveAndCheck(rawUrl: string): Promise<ResolveCheckResult> {
  if (isPrivateUrl(rawUrl)) return { ok: false, reason: 'static-rule-rejected' };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return { ok: false, reason: `invalid-url:${(err as Error).message}` };
  }
  const hostname = parsed.hostname;
  if (isPrivateIpLiteral(hostname)) return { ok: false, reason: 'ip-literal-rejected' };

  let all: DnsAddress[];
  try {
    all = await lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    return { ok: false, reason: `dns-failure:${(err as Error).message}` };
  }

  const addresses: DnsAddress[] = [];
  for (const r of all) {
    const family = net.isIP(r.address);
    if (family === 4 && isPrivateIpv4(r.address)) {
      return { ok: false, reason: `dns-resolved-private:${r.address}` };
    }
    if (family === 6 && isPrivateIpv6(r.address)) {
      return { ok: false, reason: `dns-resolved-private:${r.address}` };
    }
    if (family === 4 || family === 6) addresses.push({ family, address: r.address });
  }
  if (addresses.length === 0) return { ok: false, reason: 'no-addresses' };
  return { ok: true, addresses };
}

/** Produce a human-readable SSRF-rejection string suitable for the
 *  `ExtractedDocument.warnings` array. */
export async function describePrivateBlockReason(rawUrl: string): Promise<string> {
  if (isPrivateUrl(rawUrl)) {
    let parsed: URL | null = null;
    try { parsed = new URL(rawUrl); } catch { /* malformed */ }
    const host = parsed ? parsed.hostname : rawUrl;
    if (isLocalhostName(host)) return `URL rejected by SSRF policy: loopback host "${host}"`;
    if (isPrivateIpLiteral(host)) return `URL rejected by SSRF policy: private IP literal "${host}"`;
    return `URL rejected by SSRF policy: non-http(s) scheme or malformed URL "${rawUrl}"`;
  }
  const result = await resolveAndCheck(rawUrl);
  const reason = result.ok ? 'unexpected-success-after-failed-static-check' : result.reason;
  return `URL rejected by SSRF policy: ${reason}`;
}
