import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { createArchitectureGet } from '@/app/api/architecture/route'
import type { ArchviewSourceRecord } from '@/utilities/archviewSources'
import { sampleOneSource } from '@/utilities/hostSampling'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/**
 * The route and the sampler both write a `host-samples` row; this compares only
 * the stored data, since the row ids and the wall-clock `sampledAt` differ.
 */
const comparable = (doc: Record<string, unknown>): Record<string, unknown> => {
  const { id, sampledAt, ...rest } = doc
  void id
  void sampledAt
  const users = rest.failedLoginUsers
  return {
    ...rest,
    ...(Array.isArray(users)
      ? {
          failedLoginUsers: users.map((entry) => {
            const { id: _entryId, ...fields } = entry as Record<string, unknown>
            return fields
          }),
        }
      : {}),
  }
}

describe('host sample record shape', () => {
  let payload: Payload
  let sourceId: string
  let sourceName: string
  const origin = 'https://shape.example.test'

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const source = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `shape-source-${Date.now()}`,
        origin,
        project: 'shape-project',
        audience: `${origin}/api`,
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })
    sourceId = String(source.id)
    sourceName = String(source.name)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await payload.delete({
      collection: 'host-samples',
      where: { host: { equals: sourceId } },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'archview-sources',
      where: { id: { equals: sourceId } },
      overrideAccess: true,
    })
  })

  const lookupDefaultSource = async (): Promise<ArchviewSourceRecord> =>
    ({ id: sourceId, name: sourceName, origin }) as ArchviewSourceRecord

  const samplesForSource = async (): Promise<Array<Record<string, unknown>>> =>
    (
      await payload.find({
        collection: 'host-samples',
        where: { host: { equals: sourceId } },
        limit: 10,
        overrideAccess: true,
      })
    ).docs as unknown as Array<Record<string, unknown>>

  const waitForSamples = async (count: number): Promise<Array<Record<string, unknown>>> => {
    let docs = await samplesForSource()
    for (let i = 0; i < 40 && docs.length < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      docs = await samplesForSource()
    }
    return docs
  }

  const clearSamples = async () => {
    await payload.delete({
      collection: 'host-samples',
      where: { host: { equals: sourceId } },
      overrideAccess: true,
    })
  }

  const fullTelemetry = {
    telemetry: {
      metrics: {
        cpuAvg: 12.5,
        memoryUsedBytes: 1048576,
        memoryTotalBytes: 8388608,
        memoryPercent: 12.5,
        loadAvg: 0.75,
        diskPercent: 41.2,
        swapPercent: 3.5,
        processCount: 221,
        hostCount: 1,
        networkRxMB: 10.5,
        networkTxMB: 4.25,
        failedLogins: 7,
        failedLoginUsers: [
          { user: 'root', count: 4 },
          { user: 'admin', count: 3 },
        ],
        updatedAt: '2026-11-03T10:00:00.000Z',
      },
      hosts: [{ cpuCount: 4 }, { cpuCount: 8 }],
    },
  }

  const writeThroughRoute = async (body: unknown) => {
    const GET = createArchitectureGet({
      env: {},
      fetchImpl: async () => jsonResponse(body),
      lookupSource: async () => null,
      lookupDefaultSource,
    })
    await GET(new Request('https://cms.example/api/architecture?project=shape-project'))
  }

  it('stores identical records from the route and the sampler for the same payload', async () => {
    await clearSamples()

    await writeThroughRoute(fullTelemetry)

    vi.stubGlobal('fetch', async () => jsonResponse(fullTelemetry))
    const result = await sampleOneSource(payload, {
      id: sourceId,
      name: sourceName,
      origin,
    })
    expect(result.status).toBe('written')

    const docs = await waitForSamples(2)
    expect(docs).toHaveLength(2)

    const [routeDoc, samplerDoc] = docs.map((doc) => comparable(doc))

    expect(Object.keys(routeDoc).sort()).toEqual(Object.keys(samplerDoc).sort())
    expect(routeDoc).toEqual(samplerDoc)
    expect(routeDoc).toMatchObject({
      cpuAvg: 12.5,
      cpuCores: 8,
      failedLogins: 7,
      failedLoginUsers: [
        { user: 'root', count: 4 },
        { user: 'admin', count: 3 },
      ],
    })
  })

  it('stores failed logins and the per-user breakdown on a route-written sample', async () => {
    await clearSamples()

    await writeThroughRoute({
      telemetry: {
        metrics: {
          cpuAvg: 5,
          failedLogins: 3,
          failedLoginUsers: [{ user: 'deploy', count: 3 }],
        },
        hosts: [{ cpuCount: 16 }],
      },
    })

    const docs = await waitForSamples(1)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      cpuAvg: 5,
      cpuCores: 16,
      failedLogins: 3,
      failedLoginUsers: [{ user: 'deploy', count: 3 }],
    })
  })

  it('stores [] and omits cpuCores when a route payload has neither', async () => {
    await clearSamples()

    await writeThroughRoute({ telemetry: { metrics: { cpuAvg: 9 } } })

    const docs = await waitForSamples(1)
    expect(docs).toHaveLength(1)
    expect(docs[0].failedLoginUsers).toEqual([])
    expect(docs[0].failedLogins ?? null).toBeNull()
    expect(docs[0].cpuCores ?? null).toBeNull()
    expect(docs[0].hostLabel).toBe(sourceName)
  })

  it('keeps the sampler validation rules on a route-written sample', async () => {
    await clearSamples()

    await writeThroughRoute({
      telemetry: {
        metrics: {
          cpuAvg: 2,
          // A fraction is not a login count, so it is dropped rather than
          // rounded; invalid user entries are dropped individually.
          failedLogins: 1.5,
          failedLoginUsers: [
            { user: 'root', count: 2.5 },
            { user: '', count: 1 },
            { user: 'admin', count: 0 },
          ],
        },
        hosts: [{ cpuCount: -4 }, { cpuCount: 'nonsense' }],
      },
    })

    const docs = await waitForSamples(1)
    expect(docs).toHaveLength(1)
    expect(docs[0].failedLogins ?? null).toBeNull()
    expect(comparable(docs[0]).failedLoginUsers).toEqual([{ user: 'admin', count: 0 }])
    expect(docs[0].cpuCores ?? null).toBeNull()
  })
})
