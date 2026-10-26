import { describe, expect, it, vi } from 'vitest'

import { createErrorReportPost } from '@/app/api/error-report/route'
import { FixedWindowRateLimiter } from '@/utilities/rateLimit'
import type { ErrorReportInput } from '@/utilities/errorLog'

const recordStub = () => {
  const calls: ErrorReportInput[] = []
  return {
    calls,
    record: async (input: ErrorReportInput) => {
      calls.push(input)
      return { stored: true }
    },
  }
}

const post = (
  body: string,
  headers: Record<string, string> = {},
): Request =>
  new Request('http://localhost/api/error-report', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'endpoint-test',
      ...headers,
    },
    body,
  })

const freshDeps = () => ({
  ipLimiter: new FixedWindowRateLimiter(100, 60_000),
  globalLimiter: new FixedWindowRateLimiter(1_000, 60_000),
})

describe('POST /api/error-report', () => {
  it('accepts a report, scrubs it and stamps server metadata', async () => {
    const { calls, record } = recordStub()
    const handler = createErrorReportPost({ ...freshDeps(), record })

    const response = await handler(
      post(
        JSON.stringify({
          level: 'error',
          source: 'server',
          message: 'Login failed password=hunter2',
          stack: 'at http://socket-proxy:2375/version mongodb://u:p@mongo:27017/db',
          url: 'https://www.rossmoney.me/contact?token=supersecret',
          environment: 'client-claimed',
          release: 'client-claimed',
        }),
        { 'x-forwarded-for': '203.0.113.10' },
      ),
    )

    expect(response.status).toBe(202)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ ok: true })

    expect(calls).toHaveLength(1)
    const stored = calls[0]
    expect(stored.message).not.toContain('hunter2')
    expect(stored.stack).not.toContain('socket-proxy')
    expect(stored.stack).not.toContain('mongo:27017')
    expect(stored.url).toBe('https://www.rossmoney.me/contact')
    expect(stored.route).toBe('/contact')
    expect(stored.source).toBe('client')
    expect(stored.environment).not.toBe('client-claimed')
    expect(stored.release).not.toBe('client-claimed')
    expect(stored.userAgent).toBe('endpoint-test')
  })

  it('rejects an oversized body', async () => {
    const handler = createErrorReportPost({ ...freshDeps(), record: async () => undefined })
    const response = await handler(
      post(JSON.stringify({ message: 'x'.repeat(17 * 1_024) })),
    )

    expect(response.status).toBe(413)
  })

  it('rejects invalid JSON and a missing message', async () => {
    const handler = createErrorReportPost({ ...freshDeps(), record: async () => undefined })

    expect((await handler(post('{not json'))).status).toBe(400)
    expect((await handler(post(JSON.stringify({ level: 'error' })))).status).toBe(400)
  })

  it('rejects an unsupported content type', async () => {
    const handler = createErrorReportPost({ ...freshDeps(), record: async () => undefined })
    const response = await handler(
      post(JSON.stringify({ message: 'boom' }), { 'content-type': 'application/xml' }),
    )

    expect(response.status).toBe(415)
  })

  it('rate limits one address', async () => {
    const handler = createErrorReportPost({
      record: async () => undefined,
      ipLimiter: new FixedWindowRateLimiter(1, 60_000),
      globalLimiter: new FixedWindowRateLimiter(100, 60_000),
    })
    const request = () =>
      post(JSON.stringify({ message: 'rate limited' }), { 'x-forwarded-for': '203.0.113.11' })

    expect((await handler(request())).status).toBe(202)
    const blocked = await handler(request())

    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('still answers 202 when the writer fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = createErrorReportPost({
      ...freshDeps(),
      record: async () => {
        throw new Error('connect ECONNREFUSED 10.4.4.4:27017')
      },
    })

    try {
      const response = await handler(
        post(JSON.stringify({ message: 'writer down' }), {
          'x-forwarded-for': '203.0.113.12',
        }),
      )

      expect(response.status).toBe(202)
      expect(errorSpy).toHaveBeenCalled()
      expect(errorSpy.mock.calls[0][1]).not.toContain('10.4.4.4')
    } finally {
      errorSpy.mockRestore()
    }
  })
})
