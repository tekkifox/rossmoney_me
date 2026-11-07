import { describe, expect, it, vi } from 'vitest'

import {
  addressMatches,
  createMgmtAddressResolver,
  evaluateDevGate,
  forwardedClientAddress,
  isDevGateExemptPath,
} from '@/utilities/devGate'
import { DEFAULT_SITE_URL } from '@/utilities/siteURL'

const forwardedHeaders = (value?: string): Headers => {
  const headers = new Headers()
  if (value !== undefined) {
    headers.set('x-forwarded-for', value)
  }
  return headers
}

const vpnAddress = '198.51.100.20'
const visitorAddress = '203.0.113.10'

const decisionFor = (
  pathname: string,
  address: string | undefined,
  overrides: Partial<Parameters<typeof evaluateDevGate>[0]> = {},
) =>
  evaluateDevGate({
    env: { DEV_GATE: '1' },
    headers: forwardedHeaders(address),
    pathname,
    resolveAddresses: async () => [vpnAddress],
    ...overrides,
  })

describe('dev gate enabled flag', () => {
  it('passes every request when DEV_GATE is unset', async () => {
    const resolveAddresses = vi.fn<() => Promise<string[]>>(async () => [vpnAddress])

    await expect(
      evaluateDevGate({
        env: {},
        headers: forwardedHeaders(visitorAddress),
        pathname: '/',
        resolveAddresses,
      }),
    ).resolves.toEqual({ action: 'allow', reason: 'disabled' })

    expect(resolveAddresses).not.toHaveBeenCalled()
  })

  it('only treats exactly "1" as on', async () => {
    for (const value of ['0', 'true', 'yes', '']) {
      await expect(
        evaluateDevGate({
          env: { DEV_GATE: value },
          headers: forwardedHeaders(visitorAddress),
          pathname: '/',
          resolveAddresses: async () => [vpnAddress],
        }),
      ).resolves.toEqual({ action: 'allow', reason: 'disabled' })
    }
  })
})

describe('dev gate traffic', () => {
  it('allows a client whose address is the resolved VPN endpoint', async () => {
    await expect(decisionFor('/', vpnAddress)).resolves.toEqual({
      action: 'allow',
      reason: 'vpn',
    })
  })

  it('allows the VPN endpoint when it is in a CIDR entry', async () => {
    await expect(
      decisionFor('/', vpnAddress, { resolveAddresses: async () => ['198.51.100.0/24'] }),
    ).resolves.toEqual({ action: 'allow', reason: 'vpn' })
  })

  it('redirects a non-matching client to the live home page with 307', async () => {
    await expect(decisionFor('/travelling', visitorAddress)).resolves.toEqual({
      action: 'redirect',
      reason: 'not-allowed',
      status: 307,
      location: DEFAULT_SITE_URL,
    })
  })

  it('redirects when the client address header is missing', async () => {
    const decision = await decisionFor('/', undefined)

    expect(decision.action).toBe('redirect')
    expect(decision).toMatchObject({ status: 307, location: DEFAULT_SITE_URL })
  })

  it('redirects when the client address header is blank', async () => {
    const decision = await decisionFor('/', ' , ')

    expect(decision.action).toBe('redirect')
  })

  it('takes the first address from x-forwarded-for', () => {
    expect(forwardedClientAddress(forwardedHeaders(`${vpnAddress}, 10.0.0.1`))).toBe(vpnAddress)
    expect(forwardedClientAddress(forwardedHeaders(''))).toBeNull()
    expect(forwardedClientAddress(new Headers())).toBeNull()
  })

  it('allows explicit DEV_GATE_ALLOW entries without resolving the VPN name', async () => {
    const resolveAddresses = vi.fn<() => Promise<string[]>>(async () => [vpnAddress])

    await expect(
      decisionFor('/', visitorAddress, {
        env: { DEV_GATE: '1', DEV_GATE_ALLOW: `192.0.2.7, ${visitorAddress}` },
        resolveAddresses,
      }),
    ).resolves.toEqual({ action: 'allow', reason: 'allowlist' })

    await expect(
      decisionFor('/', '192.0.2.99', {
        env: { DEV_GATE: '1', DEV_GATE_ALLOW: '192.0.2.0/24' },
        resolveAddresses,
      }),
    ).resolves.toEqual({ action: 'allow', reason: 'allowlist' })

    expect(resolveAddresses).not.toHaveBeenCalled()
  })

  it('treats an unset or empty DEV_GATE_ALLOW as no extra entries', async () => {
    for (const value of [undefined, '', ' , , ']) {
      await expect(
        decisionFor('/', visitorAddress, {
          env: { DEV_GATE: '1', DEV_GATE_ALLOW: value },
          resolveAddresses: async () => [vpnAddress],
        }),
      ).resolves.toMatchObject({ action: 'redirect', status: 307 })
    }
  })

  it('skips malformed DEV_GATE_ALLOW entries without crashing or granting access', async () => {
    // One malformed entry mixed with a valid one must not hide the valid entry,
    // and a malformed entry on its own must not make the visitor match.
    await expect(
      decisionFor('/', visitorAddress, {
        env: { DEV_GATE: '1', DEV_GATE_ALLOW: `not-an-address, ${visitorAddress}` },
        resolveAddresses: async () => [vpnAddress],
      }),
    ).resolves.toEqual({ action: 'allow', reason: 'allowlist' })

    await expect(
      decisionFor('/', visitorAddress, {
        env: { DEV_GATE: '1', DEV_GATE_ALLOW: 'not-an-address, 192.0.2.0/99' },
        resolveAddresses: async () => [vpnAddress],
      }),
    ).resolves.toMatchObject({ action: 'redirect', status: 307 })
  })

  it('fails closed when the VPN name cannot be resolved', async () => {
    const decision = await decisionFor('/', vpnAddress, {
      resolveAddresses: async () => {
        throw new Error('dns unavailable')
      },
    })

    expect(decision.action).toBe('redirect')
  })
})

describe('dev gate path exemptions', () => {
  it.each([
    '/api',
    '/api/pages',
    '/api/media/backfill',
    '/_next/data/build-id/page.json',
    '/media/photo.jpg',
    '/infrastructure-map.png',
    '/favicon.ico',
    '/sitemap.xml',
    '/.well-known/security.txt',
  ])('never redirects %s', (pathname) => {
    expect(isDevGateExemptPath(pathname)).toBe(true)
  })

  it('does not exempt public pages or the admin', () => {
    for (const pathname of ['/', '/travelling', '/admin', '/admin/collections/pages']) {
      expect(isDevGateExemptPath(pathname)).toBe(false)
    }
  })

  it('allows an API request from a non-VPN address even with the gate on', async () => {
    const resolveAddresses = vi.fn<() => Promise<string[]>>(async () => [vpnAddress])

    await expect(
      decisionFor('/api/media/backfill', visitorAddress, { resolveAddresses }),
    ).resolves.toEqual({ action: 'allow', reason: 'exempt' })

    expect(resolveAddresses).not.toHaveBeenCalled()
  })
})

describe('address matching', () => {
  it('matches literal IPv4 addresses and CIDR blocks', () => {
    expect(addressMatches('192.0.2.10', '192.0.2.10')).toBe(true)
    expect(addressMatches('192.0.2.11', '192.0.2.10')).toBe(false)
    expect(addressMatches('192.0.2.10', '192.0.2.0/24')).toBe(true)
    expect(addressMatches('192.0.3.10', '192.0.2.0/24')).toBe(false)
    expect(addressMatches('192.0.2.10', '0.0.0.0/0')).toBe(true)
  })

  it('matches literal IPv6 addresses and CIDR blocks', () => {
    expect(addressMatches('2001:db8::1', '2001:db8::1')).toBe(true)
    expect(addressMatches('2001:db8::2', '2001:db8::1')).toBe(false)
    expect(addressMatches('2001:db8::2', '2001:db8::/32')).toBe(true)
    expect(addressMatches('2001:db9::2', '2001:db8::/32')).toBe(false)
  })

  it('treats an IPv4-mapped IPv6 address as its IPv4 form', () => {
    expect(addressMatches('::ffff:192.0.2.10', '192.0.2.10')).toBe(true)
    expect(addressMatches('::ffff:192.0.2.10', '192.0.2.0/24')).toBe(true)
  })

  it('rejects malformed entries and addresses', () => {
    expect(addressMatches('not-an-address', '192.0.2.0/24')).toBe(false)
    expect(addressMatches('192.0.2.10', '192.0.2.0/33')).toBe(false)
    expect(addressMatches('192.0.2.10', '192.0.2.0/abc')).toBe(false)
    expect(addressMatches('192.0.2.10', '2001:db8::/32')).toBe(false)
  })
})

describe('VPN address cache', () => {
  it('resolves once per TTL and resolves again after it expires', async () => {
    let now = 1_000_000
    const lookup = vi.fn<() => Promise<string[]>>(async () => [vpnAddress])
    const resolve = createMgmtAddressResolver({
      hostname: 'mgmt.example.com',
      lookup,
      now: () => now,
      ttlMs: 1_000,
    })

    await expect(resolve()).resolves.toEqual([vpnAddress])
    now += 500
    await expect(resolve()).resolves.toEqual([vpnAddress])
    expect(lookup).toHaveBeenCalledTimes(1)

    now += 600
    await expect(resolve()).resolves.toEqual([vpnAddress])
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('deduplicates results from the resolver', async () => {
    const resolve = createMgmtAddressResolver({
      hostname: 'mgmt.example.com',
      lookup: async () => [vpnAddress, vpnAddress],
    })

    await expect(resolve()).resolves.toEqual([vpnAddress])
  })

  it('does not look anything up when the configured host is blank', async () => {
    const lookup = vi.fn<() => Promise<string[]>>(async () => [vpnAddress])
    const resolve = createMgmtAddressResolver({ hostname: '  ', lookup })

    await expect(resolve()).resolves.toEqual([])
    expect(lookup).not.toHaveBeenCalled()
  })
})
