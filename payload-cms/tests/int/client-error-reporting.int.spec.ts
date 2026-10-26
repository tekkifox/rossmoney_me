import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  installErrorReporting,
  reportReactError,
} from '@/utilities/reportClientError'

const path = (url: string) => `${url}${Date.now()}${Math.random()}`

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const mockFetch = () => {
  const calls: Array<[string, RequestInit]> = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init])
    return Response.json({ ok: true }, { status: 202 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

describe('client error reporting', () => {
  it('reports window errors to the same-origin endpoint with keepalive', () => {
    const { calls } = mockFetch()
    cleanup = installErrorReporting()

    const message = path('client boom ')
    window.dispatchEvent(
      new ErrorEvent('error', {
        message,
        error: new Error(message),
      }),
    )

    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]
    expect(url).toBe('/api/error-report')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(init.credentials).toBe('omit')

    const body = JSON.parse(String(init.body))
    expect(body.message).toContain(message)
    expect(body.route).toBe(window.location.pathname)
    expect(body.source).toBe('client')
  })

  it('reports unhandled rejections', () => {
    const { calls } = mockFetch()
    cleanup = installErrorReporting()

    const message = path('async boom ')
    const event = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(event, 'reason', { value: new Error(message) })
    window.dispatchEvent(event)

    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0][1].body)).message).toContain(message)
  })

  it('does not send the same failure twice', () => {
    const { calls } = mockFetch()
    cleanup = installErrorReporting()

    const message = path('deduplicated boom ')
    const event = () => new ErrorEvent('error', { message, error: new Error(message) })

    window.dispatchEvent(event())
    window.dispatchEvent(event())

    expect(calls).toHaveLength(1)
  })

  it('scrubs secrets before they leave the browser', () => {
    const { calls } = mockFetch()
    cleanup = installErrorReporting()

    const message = path('failed password=hunter2 mongodb://u:p@mongo:27017/db')
    window.dispatchEvent(new ErrorEvent('error', { message, error: new Error(message) }))

    const body = String(calls[0][1].body)
    expect(body).not.toContain('hunter2')
    expect(body).not.toContain('mongo:27017')
  })

  it('reports React render errors with their digest', () => {
    const { calls } = mockFetch()

    const message = path('react boom ')
    reportReactError(Object.assign(new Error(message), { digest: 'digest-123' }))

    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0][1].body))
    expect(body.source).toBe('react')
    expect(body.stack).toContain('Digest: digest-123')
  })

  it('removes its listeners and never throws when the endpoint is down', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)

    cleanup = installErrorReporting()
    const message = path('fetch failure ')
    window.dispatchEvent(new ErrorEvent('error', { message, error: new Error(message) }))
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    cleanup()
    cleanup = undefined

    // A new event after cleanup must not reach the endpoint. Use a plain Event
    // (no `error` property) so jsdom does not report it as an uncaught error
    // when no listener is attached.
    const afterCleanup = new Event('error') as ErrorEvent
    Object.defineProperty(afterCleanup, 'message', { value: path('after cleanup listener ') })
    window.dispatchEvent(afterCleanup)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
