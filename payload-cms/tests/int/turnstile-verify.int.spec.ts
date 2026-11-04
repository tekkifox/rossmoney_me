import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TURNSTILE_MESSAGES,
  verifyTurnstileToken,
} from '@/utilities/verifyTurnstile'

const configuredEnv = { TURNSTILE_SECRET_KEY: 'turnstile-secret' }

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
      Response.json({ action: 'contact_form', success: true }),
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
      Response.json({ action: 'newsletter', success: true }),
    )

    await expect(
      verifyTurnstileToken('other-action-token', { env: configuredEnv, fetchImpl }),
    ).resolves.toEqual({ ok: false, message: TURNSTILE_MESSAGES.rejected })
  })

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
