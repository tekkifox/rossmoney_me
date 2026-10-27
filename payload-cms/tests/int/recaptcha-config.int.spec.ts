import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/recaptcha-config/route'
import { getRecaptchaToken } from '@/utilities/getRecaptchaToken'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  delete window.grecaptcha
})

describe('reCAPTCHA configuration', () => {
  it('returns the configured public site key without caching it', async () => {
    vi.stubEnv('NEXT_PUBLIC_RECAPTCHA_SITE_KEY', 'public-site-key')

    const response = GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ siteKey: 'public-site-key' })
  })

  it('reports missing runtime configuration as unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_RECAPTCHA_SITE_KEY', '')

    const response = GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'reCAPTCHA is not configured.',
    })
  })

  it('uses the runtime site key to request a contact-form token', async () => {
    const execute = vi.fn<() => Promise<string>>(async () => 'verified-token')
    const fetchMock = vi.fn<() => Promise<Response>>(async () =>
      Response.json({ siteKey: 'runtime-site-key' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const appendScript = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLScriptElement) {
        window.grecaptcha = {
          execute,
          ready: (callback) => callback(),
        }
        node.dispatchEvent(new Event('load'))
      }
      return node
    })

    await expect(getRecaptchaToken()).resolves.toBe('verified-token')
    expect(fetchMock).toHaveBeenCalledWith('/api/recaptcha-config', { cache: 'no-store' })
    expect(appendScript).toHaveBeenCalledWith(
      expect.objectContaining({
        src: 'https://www.google.com/recaptcha/api.js?render=runtime-site-key',
      }),
    )
    expect(execute).toHaveBeenCalledWith('runtime-site-key', { action: 'contact_form' })
  })
})
