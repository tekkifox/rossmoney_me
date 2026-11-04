import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TURNSTILE_ACTION,
  TURNSTILE_MESSAGES,
  verifyTurnstileToken,
} from '@/utilities/verifyTurnstile'

const configuredEnv = {
  NEXT_PUBLIC_SERVER_URL: 'https://www.rossmoney.me',
  TURNSTILE_SECRET_KEY: 'turnstile-secret',
}

describe('verifyTurnstileToken', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts a token the siteverify endpoint confirms', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ action: 'contact_form', hostname: 'www.rossmoney.me', success: true }),
    )

    const result = await verifyTurnstileToken('client-token', {
      env: configuredEnv,
      fetchImpl,
    })

    expect(result).toEqual({ ok: true, skipped: false })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      }),
    )

    const body = fetchImpl.mock.calls[0]?.[1]?.body
    expect(body?.toString()).toBe('secret=turnstile-secret&response=client-token')
  })

  it('rejects a token the siteverify endpoint refuses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ 'error-codes': ['invalid-input-response'], success: false }),
    )

    await expect(
      verifyTurnstileToken('rejected-token', { env: configuredEnv, fetchImpl }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.rejected })
  })

  it('rejects a token minted for another widget action', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ action: 'newsletter', hostname: 'www.rossmoney.me', success: true }),
    )

    await expect(
      verifyTurnstileToken('other-action-token', { env: configuredEnv, fetchImpl }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.rejected })
  })

  it('rejects a token solved on a hostname outside the allowlist', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ action: TURNSTILE_ACTION, hostname: 'evil.example.com', success: true }),
    )

    await expect(
      verifyTurnstileToken('foreign-host-token', { env: configuredEnv, fetchImpl }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.rejected })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('evil.example.com'))
  })

  it('rejects a token with no hostname', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ action: TURNSTILE_ACTION, success: true }),
    )

    await expect(
      verifyTurnstileToken('hostless-token', { env: configuredEnv, fetchImpl }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.rejected })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('(missing)'))
  })

  it.each(['www.rossmoney.me', 'rossmoney.me'])(
    'accepts a token solved on %s with the derived default allowlist',
    async (hostname) => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        Response.json({ action: TURNSTILE_ACTION, hostname, success: true }),
      )

      await expect(
        verifyTurnstileToken('client-token', { env: configuredEnv, fetchImpl }),
      ).resolves.toEqual({ ok: true, skipped: false })
    },
  )

  it('uses TURNSTILE_HOSTNAMES instead of the derived default', async () => {
    const env = {
      ...configuredEnv,
      TURNSTILE_HOSTNAMES: '  FORMS.Example.com , , portal.example.com ',
    }

    const allowed = vi.fn<typeof fetch>(async () =>
      Response.json({ action: TURNSTILE_ACTION, hostname: 'forms.example.com', success: true }),
    )
    await expect(
      verifyTurnstileToken('client-token', { env, fetchImpl: allowed }),
    ).resolves.toEqual({ ok: true, skipped: false })

    const derivedButNotConfigured = vi.fn<typeof fetch>(async () =>
      Response.json({ action: TURNSTILE_ACTION, hostname: 'www.rossmoney.me', success: true }),
    )
    await expect(
      verifyTurnstileToken('client-token', { env, fetchImpl: derivedButNotConfigured }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.rejected })
  })

  it('rejects an over-long token without contacting Cloudflare', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyTurnstileToken('x'.repeat(2_049), { env: configuredEnv, fetchImpl }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.rejected })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed in production when no hostname allowlist can be derived', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyTurnstileToken('client-token', {
        env: { NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'turnstile-secret' },
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.misconfigured })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000'])(
    'never derives %s as a production hostname',
    async (serverURL) => {
      const fetchImpl = vi.fn<typeof fetch>()

      await expect(
        verifyTurnstileToken('client-token', {
          env: {
            NODE_ENV: 'production',
            NEXT_PUBLIC_SERVER_URL: serverURL,
            TURNSTILE_SECRET_KEY: 'turnstile-secret',
          },
          fetchImpl,
        }),
      ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.misconfigured })
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it('rejects a missing token without contacting Cloudflare', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(verifyTurnstileToken('  ', { env: configuredEnv, fetchImpl })).resolves.toEqual({
      ok: false,
      message: TURNSTILE_MESSAGES.missingToken,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns a readable error when the request fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('network down')
    })

    await expect(
      verifyTurnstileToken('client-token', { env: configuredEnv, fetchImpl }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.unavailable })
  })

  it('returns a readable error when Cloudflare does not answer within the timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )

    await expect(
      verifyTurnstileToken('client-token', {
        env: configuredEnv,
        fetchImpl,
        timeoutMs: 5,
      }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.unavailable })
  })

  it('skips verification outside production when no secret is configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyTurnstileToken('client-token', { env: { NODE_ENV: 'test' }, fetchImpl }),
    ).resolves.toEqual({ ok: true, skipped: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed in production when no secret is configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyTurnstileToken('client-token', {
        env: { NODE_ENV: 'production' },
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.misconfigured })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps a Vercel preview deployment usable without a secret', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyTurnstileToken('client-token', {
        env: { NODE_ENV: 'production', VERCEL_ENV: 'preview' },
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true, skipped: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
