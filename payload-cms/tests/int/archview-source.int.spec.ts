import { describe, expect, it } from 'vitest'

import { createArchitectureGet, resolveArchviewSource } from '@/app/api/architecture/route'
import type { ArchviewSourceCredentials } from '@/utilities/archviewAuth'

const env = {
  ARCHVIEW_URL: 'https://archview.rossmoney.me',
  ARCHVIEW_ALLOWED_SOURCES: 'https://archview.vortexservers.co.uk, https://archview.example.com',
}

describe('resolveArchviewSource', () => {
  it('accepts the configured ARCHVIEW_URL origin', () => {
    expect(resolveArchviewSource('https://archview.rossmoney.me', env)).toBe(
      'https://archview.rossmoney.me',
    )
  })

  it('accepts an allowlisted origin', () => {
    expect(resolveArchviewSource('https://archview.vortexservers.co.uk', env)).toBe(
      'https://archview.vortexservers.co.uk',
    )
    expect(resolveArchviewSource('https://archview.example.com/some/path', env)).toBe(
      'https://archview.example.com',
    )
  })

  it('rejects non-HTTPS sources', () => {
    expect(resolveArchviewSource('http://archview.vortexservers.co.uk', env)).toBeNull()
  })

  it('rejects private addresses even when they are allowlisted', () => {
    expect(resolveArchviewSource('https://192.168.1.10', env)).toBeNull()
    expect(resolveArchviewSource('https://localhost:8080', env)).toBeNull()
    expect(resolveArchviewSource('https://[::1]', env)).toBeNull()
  })

  it('rejects unlisted hosts and malformed values', () => {
    expect(resolveArchviewSource('https://archview.evil.example', env)).toBeNull()
    expect(resolveArchviewSource('not a url', env)).toBeNull()
    expect(resolveArchviewSource('', env)).toBeNull()
    expect(resolveArchviewSource(null, env)).toBeNull()
  })
})

describe('architecture proxy explicit source failures', () => {
  const sourceOne: ArchviewSourceCredentials = {
    origin: 'https://archview.failing.example',
    audience: 'https://archview.failing.example/api',
    tokenUrl: 'https://identity.failing.example/oauth/token',
    clientId: 'cms-one',
    clientSecret: 'secret-one',
    scope: 'archview:read',
  }

  const requestURL = (input: RequestInfo | URL): string =>
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

  it('returns a failure response when a named source answers 500 and never calls the default host', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = requestURL(input)
      if (url.startsWith('https://identity.failing.example/')) {
        return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      calls.push(url)
      return new Response('boom', { status: 500 })
    }
    const GET = createArchitectureGet({
      env,
      fetchImpl,
      lookupSource: async (origin) => (origin === sourceOne.origin ? sourceOne : null),
      lookupDefaultSource: async () => null,
    })

    const response = await GET(
      new Request(
        `https://cms.example/api/architecture?source=${encodeURIComponent(sourceOne.origin)}`,
      ),
    )

    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.archviewSourceFailure).toBe(true)
    expect(body.source).toBe('requested source')
    expect(body.source).not.toContain(sourceOne.origin)
    expect(body.reason).toBe('upstream returned 500')

    // Only the requested host was tried, so no other machine's snapshot can
    // be substituted for it.
    expect(calls).toEqual([`${sourceOne.origin}/api/architecture`])
  })

  it('keeps the environment fallback when no source is named', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(requestURL(input))
      return new Response(JSON.stringify({ title: 'default' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const GET = createArchitectureGet({
      env: { ...env, ARCHVIEW_URL: 'https://default.example.test' },
      fetchImpl,
      lookupSource: async () => null,
      lookupDefaultSource: async () => null,
    })

    const response = await GET(new Request('https://cms.example/api/architecture'))

    expect(response.status).toBe(200)
    expect(calls).toEqual(['https://default.example.test/api/architecture'])
  })
})
