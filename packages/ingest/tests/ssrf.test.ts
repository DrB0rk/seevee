import { describe, it, expect } from 'vitest';

import {
  assertUrlSafe,
  describePrivateBlockReason,
  ipv4ToInt,
  isLocalhostName,
  isPrivateHost,
  isPrivateIpLiteral,
  isPrivateIpv4,
  isPrivateIpv6,
  isPrivateUrl,
  resolveAndCheck,
} from '../src/ssrf.js';

describe('ipv4ToInt', () => {
  it('parses a canonical IPv4', () => {
    expect(ipv4ToInt('10.0.0.1')).toBe(0x0a000001);
  });

  it('parses edge values', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(ipv4ToInt('255.255.255.255')).toBe(0xffffffff);
  });

  it('rejects malformed input', () => {
    expect(ipv4ToInt('10.0.0')).toBeNull();
    expect(ipv4ToInt('10.0.0.256')).toBeNull();
    expect(ipv4ToInt('-1.2.3.4')).toBeNull();
    expect(ipv4ToInt('10.0.0.1.0')).toBeNull();
    expect(ipv4ToInt('::1')).toBeNull();
    expect(ipv4ToInt('abc')).toBeNull();
  });
});

describe('isPrivateIpv4', () => {
  it('flags loopback', () => {
    expect(isPrivateIpv4('127.0.0.1')).toBe(true);
    expect(isPrivateIpv4('127.255.255.254')).toBe(true);
  });

  it('flags RFC 1918 ranges', () => {
    expect(isPrivateIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateIpv4('10.255.255.255')).toBe(true);
    expect(isPrivateIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateIpv4('172.31.255.255')).toBe(true);
    expect(isPrivateIpv4('192.168.0.1')).toBe(true);
    expect(isPrivateIpv4('192.168.255.255')).toBe(true);
  });

  it('flags link-local and multicast', () => {
    expect(isPrivateIpv4('169.254.0.1')).toBe(true);
    expect(isPrivateIpv4('224.0.0.1')).toBe(true);
    expect(isPrivateIpv4('240.0.0.1')).toBe(true);
    expect(isPrivateIpv4('0.1.2.3')).toBe(true);
  });

  it('accepts public IPs', () => {
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('1.1.1.1')).toBe(false);
    expect(isPrivateIpv4('172.32.0.1')).toBe(false);
    expect(isPrivateIpv4('11.0.0.1')).toBe(false);
    expect(isPrivateIpv4('192.169.0.1')).toBe(false);
    expect(isPrivateIpv4('127.0.0.1.0')).toBe(false);
  });

  it('returns false on invalid input', () => {
    expect(isPrivateIpv4('not-an-ip')).toBe(false);
    expect(isPrivateIpv4('::1')).toBe(false);
  });
});

describe('isPrivateIpv6', () => {
  it('flags loopback', () => {
    expect(isPrivateIpv6('::1')).toBe(true);
    expect(isPrivateIpv6('[::1]')).toBe(true);
    expect(isPrivateIpv6('::')).toBe(true);
  });

  it('flags link-local and ULA', () => {
    expect(isPrivateIpv6('fe80::1')).toBe(true);
    expect(isPrivateIpv6('fec0::1')).toBe(true);
    expect(isPrivateIpv6('fc00::1')).toBe(true);
    expect(isPrivateIpv6('fd00::1')).toBe(true);
  });

  it('flags IPv4-mapped private addresses', () => {
    expect(isPrivateIpv6('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIpv6('::ffff:8.8.8.8')).toBe(false);
  });

  it('accepts public IPv6', () => {
    expect(isPrivateIpv6('2001:db8::1')).toBe(false);
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(false);
  });
});

describe('isPrivateIpLiteral', () => {
  it('strips brackets', () => {
    expect(isPrivateIpLiteral('[127.0.0.1]')).toBe(true);
    expect(isPrivateIpLiteral('[::1]')).toBe(true);
  });

  it('ignores non-IP hosts', () => {
    expect(isPrivateIpLiteral('example.com')).toBe(false);
  });
});

describe('isLocalhostName', () => {
  it('matches loopback names', () => {
    expect(isLocalhostName('localhost')).toBe(true);
    expect(isLocalhostName('LOCALHOST')).toBe(true);
    expect(isLocalhostName('my.local')).toBe(true);
    expect(isLocalhostName('api.localhost')).toBe(true);
  });

  it('rejects public names', () => {
    expect(isLocalhostName('seevee.dev')).toBe(false);
    expect(isLocalhostName('example.com')).toBe(false);
  });
});

describe('isPrivateHost', () => {
  it('rejects empty input', () => {
    expect(isPrivateHost('')).toBe(true);
  });

  it('rejects IP literals in private ranges', () => {
    expect(isPrivateHost('10.0.0.5')).toBe(true);
    expect(isPrivateHost('192.168.0.1')).toBe(true);
    expect(isPrivateHost('::1')).toBe(true);
  });

  it('rejects loopback names', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('foo.local')).toBe(true);
  });

  it('accepts public names and IPs', () => {
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
  });
});

describe('isPrivateUrl', () => {
  it('rejects non-http schemes', () => {
    expect(isPrivateUrl('file:///etc/passwd')).toBe(true);
    expect(isPrivateUrl('javascript:alert(1)')).toBe(true);
    expect(isPrivateUrl('ftp://example.com')).toBe(true);
  });

  it('rejects malformed URLs', () => {
    expect(isPrivateUrl('not a url')).toBe(true);
    expect(isPrivateUrl('')).toBe(true);
  });

  it('rejects loopback hosts', () => {
    expect(isPrivateUrl('http://localhost/x')).toBe(true);
    expect(isPrivateUrl('https://127.0.0.1/x')).toBe(true);
    expect(isPrivateUrl('https://10.0.0.1/x')).toBe(true);
    expect(isPrivateUrl('https://[::1]/x')).toBe(true);
  });

  it('accepts http(s) public hosts', () => {
    expect(isPrivateUrl('https://example.com/')).toBe(false);
    expect(isPrivateUrl('http://8.8.8.8/')).toBe(false);
  });
});

describe('assertUrlSafe', () => {
  it('returns false on static rejection without DNS', async () => {
    expect(await assertUrlSafe('http://127.0.0.1/')).toBe(false);
    expect(await assertUrlSafe('http://localhost/')).toBe(false);
    expect(await assertUrlSafe('http://10.0.0.5/')).toBe(false);
    expect(await assertUrlSafe('ftp://example.com')).toBe(false);
  });
});

describe('resolveAndCheck', () => {
  it('fails closed on DNS resolution errors', async () => {
    const result = await resolveAndCheck('https://nx.example.invalid/');
    expect(result.ok).toBe(false);
  });

  it('rejects IP literal without DNS lookup', async () => {
    const result = await resolveAndCheck('http://10.0.0.5/');
    expect(result.ok).toBe(false);
  });

  it('accepts localhost at the static layer with a clear reason', async () => {
    const reason = await describePrivateBlockReason('http://localhost:8080/');
    expect(reason).toMatch(/SSRF policy/);
    expect(reason).toMatch(/loopback/);
  });
});
