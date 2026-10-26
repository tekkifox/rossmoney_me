import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import {
  ERROR_LOG_LIMITS,
  fingerprintError,
  normaliseErrorReport,
  scrubErrorText,
  truncate,
} from '@/utilities/errorLog'
import { pruneOldestRows, recordError } from '@/utilities/errorLogStore'
import { buildServerErrorReport } from '@/utilities/serverErrorReport'

const runId = Math.random().toString(36).slice(2, 10)
const testRoute = (suffix: string) => `/__error-log-test/${runId}/${suffix}`

describe('error text scrubbing', () => {
  it('removes cookies, auth headers, passwords, tokens and database URLs', () => {
    const scrubbed = scrubErrorText(
      [
        'Cookie: session=abc123; theme=dark',
        'Authorization: Bearer sk_live_abcdefghijklmnop',
        'password=hunter2&token=supersecret',
        'mongodb://admin:p4ssw0rd@mongo:27017/rossmoney_me',
        'X-Api-Key: my-api-key-value',
      ].join('\n'),
      4_000,
    )

    for (const secret of [
      'abc123',
      'sk_live_abcdefghijklmnop',
      'hunter2',
      'supersecret',
      'p4ssw0rd',
      'my-api-key-value',
    ]) {
      expect(scrubbed).not.toContain(secret)
    }
    expect(scrubbed).toContain('[redacted')
  })

  it('removes internal hostnames and private addresses without mangling the brand name', () => {
    const scrubbed = scrubErrorText(
      'MongoDB connection failed: connect ECONNREFUSED 10.1.2.3:27017 at http://socket-proxy:2375/version and mongo:27017',
      1_000,
    )

    expect(scrubbed).toContain('MongoDB connection failed')
    expect(scrubbed).not.toContain('10.1.2.3')
    expect(scrubbed).not.toContain('socket-proxy')
    expect(scrubbed).not.toContain('mongo:27017')
    expect(scrubbed).toContain('[internal')
  })

  it('strips control and bidi characters and truncates by code point', () => {
    expect(scrubErrorText('hello\u0000\u202e world', 100)).toBe('hello world')
    expect(truncate('a😀b', 2)).toBe('a😀')
  })
})

describe('fingerprinting', () => {
  const base = {
    level: 'error' as const,
    source: 'client' as const,
    route: '/work',
    message: 'Failed to load item 12345 at 0xdeadbeef',
  }

  it('groups the same message with different ids', () => {
    expect(fingerprintError(base)).toBe(
      fingerprintError({ ...base, message: 'Failed to load item 99999 at 0xabcdef' }),
    )
  })

  it('keeps different routes and levels apart', () => {
    expect(fingerprintError(base)).not.toBe(fingerprintError({ ...base, route: '/cv' }))
    expect(fingerprintError(base)).not.toBe(fingerprintError({ ...base, level: 'warning' }))
  })
})

describe('normaliseErrorReport', () => {
  it('drops the query string before storing a URL', () => {
    const report = normaliseErrorReport({
      message: 'boom',
      url: 'https://www.rossmoney.me/work?token=supersecret&page=2',
      source: 'client',
    })

    expect(report).not.toBeNull()
    expect(report?.route).toBe('/work')
    expect(report?.url).toBe('https://www.rossmoney.me/work')
    expect(JSON.stringify(report)).not.toContain('supersecret')
  })

  it('rejects a report without a message', () => {
    expect(normaliseErrorReport({ message: '   ' })).toBeNull()
  })
})

describe('server error report', () => {
  it('captures the error and never reads cookie material', () => {
    const report = buildServerErrorReport(
      Object.assign(new Error('render failed'), { digest: '123' }),
      {
        path: '/broken',
        method: 'GET',
        headers: {
          'user-agent': 'vitest-agent',
          cookie: 'session=should-never-appear',
          authorization: 'Bearer should-never-appear',
        },
      },
      { routePath: '/broken', routeType: 'render' },
    )

    expect(report.message).toBe('render failed')
    expect(report.stack).toContain('Digest: 123')
    expect(report.source).toBe('server')
    expect(report.userAgent).toBe('vitest-agent')
    expect(JSON.stringify(report)).not.toContain('should-never-appear')
  })
})

describe('recordError', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    await payload.delete({
      collection: 'error-logs',
      where: { route: { like: `/__error-log-test/${runId}` } },
      overrideAccess: true,
    })
  })

  it('collapses 100 identical errors into one row with occurrences 100', async () => {
    const route = testRoute('dedup')
    const now = new Date('2026-10-26T12:00:00.000Z')

    for (let index = 0; index < 100; index += 1) {
      const result = await recordError(
        {
          level: 'error',
          source: 'client',
          message: "Cannot read properties of undefined (reading 'title')",
          stack: 'TypeError: Cannot read properties of undefined\n    at Widget (/app/widget.tsx:1:1)',
          route,
          url: `https://www.rossmoney.me${route}`,
          environment: 'vitest',
          release: 'test',
          userAgent: 'vitest',
        },
        { payload, now },
      )
      expect(result.stored).toBe(true)
    }

    const fingerprint = fingerprintError({
      level: 'error',
      source: 'client',
      route,
      message: "Cannot read properties of undefined (reading 'title')",
    })
    const rows = await payload.find({
      collection: 'error-logs',
      where: { fingerprint: { equals: fingerprint } },
      overrideAccess: true,
    })

    expect(rows.totalDocs).toBe(1)
    expect(rows.docs[0].occurrences).toBe(100)
    expect(rows.docs[0].route).toBe(route)
    expect(rows.docs[0].timestamp).toBe(now.toISOString())
    expect(rows.docs[0].lastSeen).toBe(now.toISOString())
  })

  it('creates a new row when the dedup window has passed', async () => {
    const route = testRoute('window')
    const message = 'windowed failure'
    const start = new Date('2026-10-26T12:00:00.000Z')
    const later = new Date(start.getTime() + ERROR_LOG_LIMITS.dedupWindowMs + 1_000)

    await recordError({ message, route, source: 'client' }, { payload, now: start })
    await recordError({ message, route, source: 'client' }, { payload, now: later })

    const fingerprint = fingerprintError({ level: 'error', source: 'client', route, message })
    const rows = await payload.find({
      collection: 'error-logs',
      where: { fingerprint: { equals: fingerprint } },
      overrideAccess: true,
    })

    expect(rows.totalDocs).toBe(2)
  })

  it('never throws when the database is unreachable', async () => {
    const failingPayload = {
      find: async () => {
        throw new Error('connect ECONNREFUSED 10.9.8.7:27017')
      },
    } as unknown as Payload
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const result = await recordError(
        { message: 'database is down' },
        { payload: failingPayload, timeoutMs: 100 },
      )

      expect(result).toEqual({ stored: false, reason: 'store-failed' })
      expect(errorSpy).toHaveBeenCalled()
      // The stderr copy is scrubbed as well.
      expect(errorSpy.mock.calls[0][0]).not.toContain('10.9.8.7')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('gives up on a hanging database instead of stalling the request', async () => {
    const hangingPayload = {
      find: () => new Promise(() => undefined),
    } as unknown as Payload
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const result = await recordError(
        { message: 'database is hanging' },
        { payload: hangingPayload, timeoutMs: 20 },
      )

      expect(result).toEqual({ stored: false, reason: 'timed-out' })
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('retention', () => {
  it('deletes the oldest rows until the cap is met', async () => {
    // In-memory stand-in rather than the real collection: the suite can be
    // pointed at a developer's database, and a deliberately tiny cap there
    // would delete real rows.
    const rows = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      lastSeen: new Date(2026, 0, 1, 0, index).toISOString(),
    }))
    let lastFindOptions: Record<string, unknown> = {}

    const fakePayload = {
      count: async () => ({ totalDocs: rows.length }),
      find: async (options: Record<string, unknown>) => {
        lastFindOptions = options
        const sorted = [...rows].sort((a, b) =>
          options.sort === 'lastSeen'
            ? a.lastSeen.localeCompare(b.lastSeen)
            : b.lastSeen.localeCompare(a.lastSeen),
        )
        return { docs: sorted.slice(0, (options.limit as number) ?? sorted.length) }
      },
      delete: async ({ where }: { where: { id: { in: string[] } } }) => {
        const remove = new Set(where.id.in)
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (remove.has(rows[index].id)) {
            rows.splice(index, 1)
          }
        }
        return { docs: [] }
      },
    } as unknown as Payload

    await pruneOldestRows(fakePayload, 4)

    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.id)).toEqual(['6', '7', '8', '9'])
    // Regression guard: `pagination: false` makes Payload ignore `limit` and
    // return every row, which would have let the sweep delete the whole
    // collection instead of just the overflow.
    expect(lastFindOptions.limit).toBe(6)
    expect(lastFindOptions.pagination).not.toBe(false)
  })
})
