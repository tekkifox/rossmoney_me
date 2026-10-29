import { describe, expect, it } from 'vitest'

import { browserArchitectureApi } from '@/utilities/architectureURL'
import { sessionCookieIsSecure } from '@/collections/Users'
import { OG_INPUT_LIMITS, sanitizeOgParams, sanitizeOgText } from '@/utilities/ogSanitize'
import {
  FixedWindowRateLimiter,
  SharedFixedWindowRateLimiter,
} from '@/utilities/rateLimit'
import type { RateLimitStore } from '@/utilities/rateLimitStore'
import { redactInternalEndpoints } from '@/utilities/redactInternalEndpoints'

describe('FixedWindowRateLimiter', () => {
  it('allows the configured number of requests and then refuses', () => {
    const limiter = new FixedWindowRateLimiter(2, 1000)

    expect(limiter.take('ip', 0).allowed).toBe(true)
    expect(limiter.take('ip', 1).allowed).toBe(true)
    const blocked = limiter.take('ip', 2)

    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBe(1)
  })

  it('starts a fresh window after the reset time', () => {
    const limiter = new FixedWindowRateLimiter(1, 1000)

    expect(limiter.take('ip', 0).allowed).toBe(true)
    expect(limiter.take('ip', 500).allowed).toBe(false)
    expect(limiter.take('ip', 1000).allowed).toBe(true)
  })

  it('keeps buckets per key', () => {
    const limiter = new FixedWindowRateLimiter(1, 1000)

    expect(limiter.take('a', 0).allowed).toBe(true)
    expect(limiter.take('b', 0).allowed).toBe(true)
    expect(limiter.take('a', 1).allowed).toBe(false)
  })

  it('bounds the bucket map when keys rotate', () => {
    const limiter = new FixedWindowRateLimiter(1, 1000, 2)

    limiter.take('a', 0)
    limiter.take('b', 1)
    limiter.take('c', 2)

    expect(limiter.size).toBeLessThanOrEqual(2)
  })
})

describe('SharedFixedWindowRateLimiter', () => {
  const store = (overrides: Partial<RateLimitStore> = {}): RateLimitStore => {
    let count = 0
    const resetAt = Date.now() + 60_000

    return {
      increment: async () => ({ count: ++count, resetAt }),
      ...overrides,
    }
  }

  it('takes its budget from the shared store', async () => {
    const limiter = new SharedFixedWindowRateLimiter('test', 2, 60_000, store(), 100)

    expect((await limiter.take('ip')).allowed).toBe(true)
    expect((await limiter.take('ip')).allowed).toBe(true)

    const blocked = await limiter.take('ip')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1)
  })

  it('falls back to in-memory limiting when the store throws', async () => {
    const failing = store({
      increment: async () => {
        throw new Error('database is down')
      },
    })
    const limiter = new SharedFixedWindowRateLimiter('test', 1, 60_000, failing, 100)

    expect((await limiter.take('ip')).allowed).toBe(true)
    expect((await limiter.take('ip')).allowed).toBe(false)
  })

  it('falls back to in-memory limiting when the store is slow', async () => {
    const slow = store({
      increment: () => new Promise(() => undefined),
    })
    const limiter = new SharedFixedWindowRateLimiter('test', 1, 60_000, slow, 10)

    expect((await limiter.take('ip')).allowed).toBe(true)
    expect((await limiter.take('ip')).allowed).toBe(false)
  })

  it('uses the in-memory limiter directly when no store is configured', async () => {
    const limiter = new SharedFixedWindowRateLimiter('test', 1, 60_000, null)

    expect((await limiter.take('ip')).allowed).toBe(true)
    expect((await limiter.take('ip')).allowed).toBe(false)
  })
})

describe('sanitizeOgText', () => {
  it('removes control and bidi formatting characters', () => {
    expect(sanitizeOgText('hello\u0000\u001f\u007f\u202e world', 100)).toBe('hello world')
  })

  it('caps by code point without splitting an emoji', () => {
    expect(sanitizeOgText('a😀b', 2)).toBe('a😀')
  })

  it('trims outer whitespace', () => {
    expect(sanitizeOgText('  hello  ', 100)).toBe('hello')
  })
})

describe('sanitizeOgParams', () => {
  it('reports whether it changed an input', () => {
    const safe = new URLSearchParams({ title: 'Hello', description: 'World' })
    expect(sanitizeOgParams(safe).changed).toBe(false)

    const unsafe = new URLSearchParams({
      title: 'Hello',
      description: `a\u0000${'b'.repeat(OG_INPUT_LIMITS.description + 10)}`,
    })
    const result = sanitizeOgParams(unsafe)

    expect(result.changed).toBe(true)
    expect(result.params.description).toHaveLength(OG_INPUT_LIMITS.description)
    expect(result.params.description).not.toContain('\u0000')
  })

  it('ignores parameters Payload does not interpolate', () => {
    const result = sanitizeOgParams(new URLSearchParams({ extra: 'value' }))
    expect(result.params).toEqual({})
  })
})

describe('redactInternalEndpoints', () => {
  it('removes a Docker service URL from nested page data', () => {
    const payload = {
      services: [
        {
          kind: 'daemon',
          labels: { endpoint: 'http://socket-proxy:2375' },
        },
      ],
    }

    expect(redactInternalEndpoints(payload)).toEqual({
      services: [
        {
          kind: 'daemon',
          labels: { endpoint: '[internal]' },
        },
      ],
    })
  })

  it('leaves public hosts and ordinary text alone', () => {
    const payload = {
      url: 'https://archview.vortexservers.co.uk/api/architecture',
      image: 'ghcr.io/tekkifox/archview:latest',
      words: 'socket-proxy is running',
    }

    expect(redactInternalEndpoints(payload)).toEqual(payload)
  })
})

describe('browserArchitectureApi', () => {
  const ownOrigin = { ARCHVIEW_URL: 'https://archview.rossmoney.me' }

  it('uses the same-origin proxy for the deployment’s own origin', () => {
    expect(browserArchitectureApi('https://archview.rossmoney.me', ownOrigin)).toBe('/api/architecture')
  })

  it('uses the same-origin proxy for a bare host', () => {
    expect(browserArchitectureApi('archview.vortexservers.co.uk', ownOrigin)).toBe('/api/architecture')
  })

  it('uses the same-origin proxy for loopback and internal hosts', () => {
    expect(browserArchitectureApi('http://127.0.0.1:4110')).toBe('/api/architecture')
    expect(browserArchitectureApi('http://localhost:8080')).toBe('/api/architecture')
    expect(browserArchitectureApi('http://archview:8080')).toBe('/api/architecture')
  })

  it('falls back to the proxy path when unset', () => {
    expect(browserArchitectureApi('')).toBe('/api/architecture')
    expect(browserArchitectureApi(undefined)).toBe('/api/architecture')
  })

  it('carries a different public origin to the proxy as a source', () => {
    expect(browserArchitectureApi('https://archview.vortexservers.co.uk', ownOrigin)).toBe(
      '/api/architecture?source=https%3A%2F%2Farchview.vortexservers.co.uk',
    )
  })
<<<<<<< HEAD
=======

  it('can force the source parameter for an explicitly chosen source', () => {
    expect(
      browserArchitectureApi('https://archview.rossmoney.me', ownOrigin, {
        forceSource: true,
      }),
    ).toBe('/api/architecture?source=https%3A%2F%2Farchview.rossmoney.me')
  })
>>>>>>> origin/main
})

describe('sessionCookieIsSecure', () => {
  it('is never secure in development, even with an HTTPS SERVER_URL', () => {
    expect(
      sessionCookieIsSecure({
        NODE_ENV: 'development',
        SERVER_URL: 'https://www.rossmoney.me',
      }),
    ).toBe(false)
  })

  it('is secure for the pinned HTTPS Portainer origin', () => {
    expect(
      sessionCookieIsSecure({
        NODE_ENV: 'production',
        SERVER_URL: 'https://www.rossmoney.me',
      }),
    ).toBe(true)
  })

  it('is secure on Vercel where the application URL is left unset', () => {
    expect(sessionCookieIsSecure({ NODE_ENV: 'production', VERCEL: '1' })).toBe(true)
  })

  it('stays insecure for a local production build over http', () => {
    expect(sessionCookieIsSecure({ NODE_ENV: 'production' })).toBe(false)
  })

  it('honours an explicit http origin', () => {
    expect(
      sessionCookieIsSecure({
        NODE_ENV: 'production',
        NEXT_PUBLIC_SERVER_URL: 'http://localhost:8082',
      }),
    ).toBe(false)
  })
})
