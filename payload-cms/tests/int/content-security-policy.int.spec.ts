import { describe, expect, it } from 'vitest'

import {
  archviewOrigins,
  buildContentSecurityPolicy,
  createNonce,
  VERCEL_BLOB_API_ORIGIN,
  VERCEL_BLOB_ORIGIN,
} from '@/utilities/contentSecurityPolicy'

const policy = (overrides: Partial<Parameters<typeof buildContentSecurityPolicy>[0]> = {}) =>
  buildContentSecurityPolicy({ nonce: 'abc123', vercelToolbar: false, ...overrides })

const directive = (value: string, name: string) =>
  value
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `))

describe('createNonce', () => {
  it('produces a value Next.js can parse as a nonce', () => {
    const nonce = createNonce()
    expect(nonce).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/)
    expect(nonce.length).toBeGreaterThanOrEqual(32)
  })

  it('does not repeat', () => {
    expect(createNonce()).not.toBe(createNonce())
  })
})

describe('buildContentSecurityPolicy', () => {
  it('starts from a deny-all default', () => {
    expect(policy()).toContain("default-src 'none'")
  })

  it('puts the nonce first in script-src and keeps strict-dynamic', () => {
    expect(directive(policy(), 'script-src')).toMatch(
      /^script-src 'nonce-abc123' 'strict-dynamic' 'self'( |$)/,
    )
  })

  it('allows inline style attributes without allowing inline style elements on public pages', () => {
    const value = policy()
    expect(directive(value, 'style-src')).toBe("style-src 'self'")
    expect(directive(value, 'style-src-elem')).toBe("style-src-elem 'self'")
    expect(directive(value, 'style-src-attr')).toBe("style-src-attr 'unsafe-inline'")
    expect(directive(value, 'script-src-attr')).toBe("script-src-attr 'none'")
  })

  it('keeps the documented unsafe-inline style compromise in the admin', () => {
    const value = policy({ isAdmin: true })
    expect(directive(value, 'style-src')).toContain("style-src 'self' 'unsafe-inline'")
    expect(directive(value, 'style-src-elem')).toContain('https://cdn.jsdelivr.net')
  })

  it('locks down objects, bases, framing and form targets', () => {
    const value = policy()
    expect(directive(value, 'object-src')).toBe("object-src 'none'")
    expect(directive(value, 'base-uri')).toBe("base-uri 'none'")
    expect(directive(value, 'frame-ancestors')).toBe("frame-ancestors 'self'")
    expect(directive(value, 'form-action')).toBe("form-action 'self'")
  })

  it('allows the Vercel Blob host for media and direct uploads', () => {
    const value = policy()
    expect(directive(value, 'img-src')).toContain(VERCEL_BLOB_ORIGIN)
    expect(directive(value, 'connect-src')).toContain(VERCEL_BLOB_ORIGIN)
  })

  it('allows the Vercel Blob upload API only in the admin connect-src', () => {
    const adminConnect = directive(policy({ isAdmin: true }), 'connect-src') ?? ''
    expect(adminConnect.split(/\s+/)).toContain(VERCEL_BLOB_API_ORIGIN)

    const publicConnect = directive(policy(), 'connect-src') ?? ''
    expect(publicConnect.split(/\s+/)).not.toContain(VERCEL_BLOB_API_ORIGIN)
  })

  it('does not widen the Blob API origin into any other directive', () => {
    const value = policy({ isAdmin: true })
    for (const name of ['default-src', 'script-src', 'img-src', 'style-src', 'font-src']) {
      expect(directive(value, name) ?? '').not.toContain(VERCEL_BLOB_API_ORIGIN)
    }
  })

  it('does not allow admin-only hosts on public pages', () => {
    const value = policy()
    expect(directive(value, 'img-src')).not.toContain('gravatar.com')
    expect(directive(value, 'img-src')).not.toContain('cdn.jsdelivr.net')
    expect(directive(value, 'style-src')).not.toContain('cdn.jsdelivr.net')
  })

  it('allows Gravatar and Monaco only for the admin policy', () => {
    const value = policy({ isAdmin: true })
    expect(directive(value, 'img-src')).toContain('https://www.gravatar.com')
    expect(directive(value, 'style-src')).toContain('https://cdn.jsdelivr.net')
    expect(directive(value, 'font-src')).toContain('https://cdn.jsdelivr.net')
    expect(directive(value, 'worker-src')).toContain('https://cdn.jsdelivr.net')
  })

  it('allows the known ArchView origin without opening connect-src to all HTTPS', () => {
    const connect = directive(policy(), 'connect-src') ?? ''
    expect(connect).toContain('https://archview.vortexservers.co.uk')
    expect(connect.split(/\s+/)).not.toContain('https:')
  })

  it('allows reCAPTCHA on public pages without allowing arbitrary Google frames', () => {
    const value = policy()
    expect(directive(value, 'script-src')).toContain('https://www.google.com')
    expect(directive(value, 'connect-src')).toContain('https://www.google.com')
    expect(directive(value, 'frame-src')).toBe('frame-src https://www.google.com')
  })

  it('does not allow reCAPTCHA frames or scripts in the admin policy', () => {
    const value = policy({ isAdmin: true })
    expect(directive(value, 'frame-src')).toBe("frame-src 'self'")
    expect(directive(value, 'script-src')).not.toContain('www.google.com')
  })

  it('keeps the Vercel Toolbar out of the normal policy', () => {
    const value = policy()
    expect(value).not.toContain('vercel.live')
    expect(value).not.toContain('vercel.com')
    expect(value).not.toContain('pusher.com')
    expect(directive(value, 'style-src-elem')).toBe("style-src-elem 'self'")
  })

  it('allows the documented Vercel Toolbar sources on preview deployments', () => {
    const value = policy({ vercelToolbar: true })
    expect(directive(value, 'frame-src')).toBe(
      'frame-src https://www.google.com https://vercel.live',
    )
    expect(directive(value, 'style-src')).toBe(
      "style-src 'self' https://vercel.live 'unsafe-inline'",
    )
    expect(directive(value, 'style-src-elem')).toBe(
      "style-src-elem 'self' https://vercel.live 'unsafe-inline'",
    )
    expect(directive(value, 'connect-src')).toContain('https://vercel.live')
    expect(directive(value, 'connect-src')).toContain('wss://ws-us3.pusher.com')
    expect(directive(value, 'img-src')).toContain('https://vercel.com')
    expect(directive(value, 'font-src')).toContain('https://assets.vercel.com')
    expect(directive(value, 'script-src')).toContain('https://vercel.live')
  })

  it('allows the Vercel Toolbar frame in the admin preview policy too', () => {
    const value = policy({ isAdmin: true, vercelToolbar: true })
    expect(directive(value, 'frame-src')).toBe("frame-src 'self' https://vercel.live")
    expect(directive(value, 'frame-ancestors')).toBe("frame-ancestors 'none'")
  })

  it('allows only same-origin framing for Live Preview and never in the admin', () => {
    const publicValue = policy()
    expect(directive(publicValue, 'frame-src')).toBe('frame-src https://www.google.com')
    expect(directive(publicValue, 'frame-ancestors')).toBe("frame-ancestors 'self'")

    const adminValue = policy({ isAdmin: true })
    expect(directive(adminValue, 'frame-src')).toBe("frame-src 'self'")
    expect(directive(adminValue, 'frame-ancestors')).toBe("frame-ancestors 'none'")
  })

  it('does not add upgrade-insecure-requests on HTTP', () => {
    expect(policy({ isHttps: false })).not.toContain('upgrade-insecure-requests')
  })

  it('adds upgrade-insecure-requests on HTTPS', () => {
    expect(policy({ isHttps: true })).toContain('upgrade-insecure-requests')
  })

  it('drops unusable extra connect origins instead of emitting a broken source', () => {
    const connect = directive(policy({ connectOrigins: ['not a url'] }), 'connect-src') ?? ''
    expect(connect).not.toContain('not a url')
  })
})

describe('archviewOrigins', () => {
  it('always keeps the known public ArchView origin', () => {
    expect(archviewOrigins({})).toContain('https://archview.vortexservers.co.uk')
  })

  it('turns a scheme-less ARCHVIEW_HOST into an HTTPS origin', () => {
    expect(archviewOrigins({ ARCHVIEW_HOST: 'archview.example.test:8080' })).toContain(
      'https://archview.example.test:8080',
    )
  })

  it('normalises a configured ARCHVIEW_URL and de-duplicates it', () => {
    expect(
      archviewOrigins({
        ARCHVIEW_URL: 'https://archview.vortexservers.co.uk/',
      }).filter((origin) => origin === 'https://archview.vortexservers.co.uk'),
    ).toHaveLength(1)
  })

  it('never puts an internal HTTP ArchView host in the browser policy', () => {
    expect(archviewOrigins({ ARCHVIEW_URL: 'http://archview:8080' })).not.toContain(
      'http://archview:8080',
    )
  })
})
