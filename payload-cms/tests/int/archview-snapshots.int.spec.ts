import { randomBytes } from 'node:crypto'

import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createArchitectureGet } from '@/app/api/architecture/route'
import config from '@/payload.config'
import { loadArchitectureSnapshot } from '@/utilities/architectureSnapshot'
import {
  SNAPSHOT_WRITE_THROTTLE_MS,
  cacheKeyFor,
  readCachedSnapshot,
  writeCachedSnapshot,
} from '@/utilities/architectureStore'
import { clearArchviewTokenCache } from '@/utilities/archviewAuth'
import { resolvePageArchviewSource } from '@/utilities/archviewPageSource'
import { encryptArchviewSecret } from '@/utilities/archviewSourceSecret'

const runId = randomBytes(4).toString('hex')
const KEY = randomBytes(32).toString('base64')
const WRONG_KEY = randomBytes(32).toString('base64')

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const requestURL = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

const origin = (suffix: string) => `https://snapshot-${suffix}-${runId}.example.test`

const fullSnapshot = (title: string) => ({
  title,
  updatedAt: '2026-11-04T21:30:00.000Z',
  services: ['portfolio'],
  nodes: [{ name: 'host-a', cpuCount: 4 }],
  images: [{ name: 'ghcr.io/example/portfolio:latest', description: 'portfolio' }],
  regions: ['home'],
  endpoints: [
    { name: 'architecture', url: 'https://archview.example.com/api/architecture' },
    { name: 'docker', url: 'http://socket-proxy:2375/containers/json' },
  ],
  telemetry: { metrics: { cpuAvg: 12.5, memoryPercent: 43.2 } },
})

let payload: Payload
const keys = new Set<string>()
const sourceIds = new Set<string>()
const previousKey = process.env.ARCHVIEW_SECRET_KEY
const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})

beforeAll(async () => {
  payload = await getPayload({ config: await config })
})

afterEach(() => {
  clearArchviewTokenCache()
  if (previousKey === undefined) {
    delete process.env.ARCHVIEW_SECRET_KEY
  } else {
    process.env.ARCHVIEW_SECRET_KEY = previousKey
  }
})

afterAll(async () => {
  warned.mockRestore()
  if (keys.size > 0) {
    await payload.delete({
      collection: 'archview-snapshots',
      where: { key: { in: [...keys] } },
      overrideAccess: true,
    })
  }
  if (sourceIds.size > 0) {
    await payload.delete({
      collection: 'archview-sources',
      where: { id: { in: [...sourceIds] } },
      overrideAccess: true,
    })
  }
})

async function createSource(suffix: string, project: string, clientSecret?: string) {
  const data = {
    name: `snapshot-${suffix}-${runId}`,
    origin: origin(suffix),
    project,
    audience: `${origin(suffix)}/api`,
    tokenUrl: 'https://identity.example.test/oauth/token',
    ...(clientSecret ? { clientId: `client-${suffix}`, clientSecret } : {}),
    scope: 'archview:read',
    enabled: true,
  } as RequiredDataFromCollectionSlug<'archview-sources'>

  const created = await payload.create({
    collection: 'archview-sources',
    data,
    overrideAccess: true,
  })
  sourceIds.add(String(created.id))
  return {
    id: String(created.id),
    name: data.name,
    origin: data.origin,
    project: data.project ?? undefined,
  }
}

async function seedCache(
  identity: { sourceId?: string; origin?: string; project?: string },
  snapshot: Record<string, unknown>,
  fetchedAt: number,
) {
  const key = cacheKeyFor(identity)
  keys.add(key)
  const result = await writeCachedSnapshot(payload, identity, snapshot, {
    now: fetchedAt,
    throttleMs: 0,
  })
  expect(result.written).toBe(true)
  return key
}

async function findCache(key: string) {
  const result = await payload.find({
    collection: 'archview-snapshots',
    where: { key: { equals: key } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs[0] as unknown as Record<string, unknown> | undefined
}

describe('ArchView snapshot cache', () => {
  it('writes the whole redacted snapshot after a successful page render', async () => {
    const project = `write-${runId}`
    const pageOrigin = origin('write')
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(requestURL(input))
      return jsonResponse(fullSnapshot('written'))
    }

    const result = await loadArchitectureSnapshot(
      { archviewUrl: pageOrigin, data: {} },
      null,
      { payload, env: {}, fetchImpl, project },
    )

    expect(result?.title).toBe('written')
    expect(calls).toEqual([`${pageOrigin}/api/architecture?project=${project}`])

    const key = cacheKeyFor({ origin: pageOrigin, project })
    keys.add(key)
    const row = await findCache(key)
    expect(row).toBeDefined()
    expect(row?.snapshot).toMatchObject({
      title: 'written',
      images: fullSnapshot('written').images,
      nodes: fullSnapshot('written').nodes,
      services: fullSnapshot('written').services,
      regions: fullSnapshot('written').regions,
      telemetry: fullSnapshot('written').telemetry,
    })
    // Redaction happens before storage, so the row cannot expose the Docker name.
    expect(JSON.stringify(row?.snapshot)).not.toContain('socket-proxy')
    expect(row?.snapshot).toMatchObject({
      endpoints: expect.arrayContaining([{ name: 'docker', url: '[internal]' }]),
    })
  })

  it('serves the last good row when the live page fetch fails', async () => {
    const project = `failure-${runId}`
    const pageOrigin = origin('failure')
    await seedCache({ origin: pageOrigin, project }, fullSnapshot('cached'), Date.now() - 5_000)
    keys.add(cacheKeyFor({ origin: pageOrigin, project }))

    const fetchImpl: typeof fetch = async () => new Response('boom', { status: 503 })
    const result = await loadArchitectureSnapshot(
      { archviewUrl: pageOrigin, data: {} },
      null,
      { payload, env: {}, fetchImpl, project },
    )

    expect(result?.title).toBe('cached')
    expect(result?.images).toEqual(fullSnapshot('cached').images)
  })

  it('returns the degraded state when a failure has no row to serve', async () => {
    const project = `miss-${runId}`
    const pageOrigin = origin('miss')
    const fetchImpl: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED')
    }

    await expect(
      loadArchitectureSnapshot(
        { archviewUrl: pageOrigin, data: {} },
        null,
        { payload, env: {}, fetchImpl, project },
      ),
    ).resolves.toBeNull()
  })

  it('never overwrites a good row with a failure', async () => {
    const project = `preserve-${runId}`
    const pageOrigin = origin('preserve')
    const fetchedAt = Date.now() - 10 * 60_000
    const key = await seedCache(
      { origin: pageOrigin, project },
      fullSnapshot('good'),
      fetchedAt,
    )
    keys.add(key)

    const fetchImpl: typeof fetch = async () => new Response('unavailable', { status: 502 })
    const result = await loadArchitectureSnapshot(
      { archviewUrl: pageOrigin, data: {} },
      null,
      { payload, env: {}, fetchImpl, project },
    )

    expect(result?.title).toBe('good')
    const row = await findCache(key)
    expect(row?.snapshot).toMatchObject({ title: 'good' })
    expect(new Date(String(row?.fetchedAt)).getTime()).toBe(fetchedAt)
  })

  it('throttles writes and skips an unchanged snapshot', async () => {
    const project = `throttle-${runId}`
    const pageOrigin = origin('throttle')
    const identity = { origin: pageOrigin, project }
    keys.add(cacheKeyFor(identity))
    const start = Date.now()

    await expect(
      writeCachedSnapshot(payload, identity, fullSnapshot('first'), { now: start }),
    ).resolves.toEqual({ written: true })

    await expect(
      writeCachedSnapshot(payload, identity, fullSnapshot('second'), {
        now: start + 30_000,
      }),
    ).resolves.toEqual({ written: false, reason: 'throttled' })
    expect((await findCache(cacheKeyFor(identity)))?.snapshot).toMatchObject({ title: 'first' })

    await expect(
      writeCachedSnapshot(payload, identity, fullSnapshot('second'), {
        now: start + SNAPSHOT_WRITE_THROTTLE_MS + 1_000,
      }),
    ).resolves.toEqual({ written: true })
    const updatedAt = new Date(
      String((await findCache(cacheKeyFor(identity)))?.fetchedAt),
    ).getTime()

    await expect(
      writeCachedSnapshot(payload, identity, fullSnapshot('second'), {
        now: start + SNAPSHOT_WRITE_THROTTLE_MS * 2 + 30_000,
      }),
    ).resolves.toEqual({ written: false, reason: 'unchanged' })
    expect(
      new Date(String((await findCache(cacheKeyFor(identity)))?.fetchedAt)).getTime(),
    ).toBe(updatedAt)
  })

  it('normalises origin, source id and project into one key', () => {
    expect(
      cacheKeyFor({ origin: 'HTTPS://ArchView.Example.COM/', project: ' p ' }),
    ).toBe(cacheKeyFor({ origin: 'https://archview.example.com', project: 'p' }))
    expect(
      cacheKeyFor({ sourceId: ' abc ', origin: 'https://ignored.example', project: 'p' }),
    ).toBe('id:abc|p')
    expect(cacheKeyFor({ origin: origin('key'), project: '' })).toMatch(/\|$/)
  })

  it('serves a stale row inside the ceiling and treats an older row as a miss', async () => {
    const project = `stale-${runId}`
    const pageOrigin = origin('stale')
    const fetchedAt = Date.now() - 2_000
    await seedCache({ origin: pageOrigin, project }, fullSnapshot('stale'), fetchedAt)
    keys.add(cacheKeyFor({ origin: pageOrigin, project }))

    const fresh = await readCachedSnapshot(
      payload,
      cacheKeyFor({ origin: pageOrigin, project }),
      { maxAgeMs: 60_000, freshnessMs: 500 },
    )
    expect(fresh?.stale).toBe(true)
    expect(fresh?.snapshot.title).toBe('stale')

    const tooOld = await readCachedSnapshot(
      payload,
      cacheKeyFor({ origin: pageOrigin, project }),
      { maxAgeMs: 1_000 },
    )
    expect(tooOld).toBeNull()

    // The ceiling can also be set from the environment (fractional days are
    // accepted, which keeps the test fast).
    const envTooOld = await readCachedSnapshot(
      payload,
      cacheKeyFor({ origin: pageOrigin, project }),
      { env: { ARCHVIEW_SNAPSHOT_MAX_AGE_DAYS: '0.00001' } },
    )
    expect(envTooOld).toBeNull()
  })
})

describe('page and proxy share the cache', () => {
  it('returns the same cached row from the route and the page, with a hit header', async () => {
    const project = `shared-${runId}`
    const source = await createSource('shared', project)
    const key = await seedCache(
      { sourceId: source.id, origin: source.origin, project },
      fullSnapshot('shared-cache'),
      Date.now(),
    )
    keys.add(key)

    const failingFetch: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED')
    }

    const GET = createArchitectureGet({
      env: {},
      fetchImpl: failingFetch,
      payload,
      lookupSource: async (ref) =>
        ref === source.id || ref === source.origin
          ? {
              id: source.id,
              name: source.name,
              origin: source.origin,
              project: source.project,
            }
          : null,
      lookupDefaultSource: async () => null,
    })

    const response = await GET(
      new Request(
        `https://cms.example/api/architecture?source=${source.id}&project=${encodeURIComponent(project)}`,
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-archview-cache')).toBe('hit')
    await expect(response.json()).resolves.toMatchObject({ title: 'shared-cache' })

    const pageResult = await loadArchitectureSnapshot(
      { archviewSource: source.id, data: {} },
      null,
      { payload, env: {}, fetchImpl: failingFetch, project },
    )
    expect(pageResult?.title).toBe('shared-cache')
  })

  it('writes a row from a successful proxy fetch', async () => {
    const project = `route-write-${runId}`
    const proxyOrigin = origin('route-write')
    const fetchImpl: typeof fetch = async () => jsonResponse(fullSnapshot('route-written'))
    const GET = createArchitectureGet({
      env: {},
      fetchImpl,
      payload,
      lookupSource: async (ref) =>
        ref === proxyOrigin
          ? { origin: proxyOrigin, name: 'proxy source' }
          : null,
      lookupDefaultSource: async () => null,
    })

    const response = await GET(
      new Request(
        `https://cms.example/api/architecture?source=${encodeURIComponent(proxyOrigin)}&project=${project}`,
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-archview-cache')).toBe('miss')

    const key = cacheKeyFor({ origin: proxyOrigin, project })
    keys.add(key)
    const row = await findCache(key)
    expect(row?.snapshot).toMatchObject({ title: 'route-written' })
    expect(row?.sourceName).toBe('proxy source')
  })

  it('still returns the degraded snapshot when no row exists', async () => {
    const project = `route-miss-${runId}`
    const proxyOrigin = origin('route-miss')
    const fetchImpl: typeof fetch = async () => new Response('down', { status: 500 })
    const GET = createArchitectureGet({
      env: { ARCHVIEW_URL: proxyOrigin },
      fetchImpl,
      payload,
      lookupSource: async () => null,
      lookupDefaultSource: async () => null,
    })

    const response = await GET(
      new Request(`https://cms.example/api/architecture?project=${project}`),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ degraded: true })
  })
})

describe('source resolution without ARCHVIEW_SECRET_KEY', () => {
  it('resolves a source with an undecryptable secret and serves its cache', async () => {
    const project = `nokey-${runId}`
    process.env.ARCHVIEW_SECRET_KEY = KEY
    const source = await createSource(
      'nokey',
      project,
      encryptArchviewSecret('stored-secret', { ARCHVIEW_SECRET_KEY: KEY }),
    )
    // Simulate a key rotation / missing key in this process.
    process.env.ARCHVIEW_SECRET_KEY = WRONG_KEY

    const resolved = await resolvePageArchviewSource(
      { archviewSource: source.id, data: {} },
      null,
      { payload, env: {} },
    )

    expect(resolved).toMatchObject({
      kind: 'relation',
      id: source.id,
      origin: source.origin,
      project,
    })
    expect(resolved).not.toMatchObject({ kind: 'failure' })
    expect((resolved as { credentials?: unknown }).credentials).toBeUndefined()

    const key = await seedCache(
      { sourceId: source.id, origin: source.origin, project },
      fullSnapshot('undecryptable-cache'),
      Date.now(),
    )
    keys.add(key)

    const failingFetch: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED')
    }
    const snapshot = await loadArchitectureSnapshot(
      { archviewSource: source.id, data: {} },
      null,
      { payload, env: {}, fetchImpl: failingFetch, project },
    )
    expect(snapshot?.title).toBe('undecryptable-cache')
  })

  it('resolves a source when ARCHVIEW_SECRET_KEY is absent', async () => {
    const project = `missing-key-${runId}`
    process.env.ARCHVIEW_SECRET_KEY = KEY
    const source = await createSource(
      'missing-key',
      project,
      encryptArchviewSecret('stored-secret', { ARCHVIEW_SECRET_KEY: KEY }),
    )
    delete process.env.ARCHVIEW_SECRET_KEY

    const resolved = await resolvePageArchviewSource(
      { archviewSource: source.id, data: {} },
      null,
      { payload, env: {} },
    )
    expect(resolved).toMatchObject({
      kind: 'relation',
      id: source.id,
      origin: source.origin,
      project,
    })
  })
})
