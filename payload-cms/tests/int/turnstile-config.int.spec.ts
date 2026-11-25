import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/turnstile-config/route'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Turnstile configuration', () => {
  it('returns the configured public site key without caching it', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key')
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key')

    const response = GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    return expect(response.json()).resolves.toEqual({
      required: true,
      siteKey: 'public-site-key',
    })
  })

  it('reports missing keys as unconfigured but still tells the client whether they are required', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')

    const response = GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ required: true, siteKey: null })
  })

  it('does not require a challenge on a Vercel preview deployment', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')

    const response = GET()

    await expect(response.json()).resolves.toEqual({ required: false, siteKey: null })
  })

  it('serves the public site key at runtime without exposing the secret', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')

    const response = GET()

    await expect(response.json()).resolves.toEqual({
      required: false,
      siteKey: 'public-site-key',
    })
  })
})
