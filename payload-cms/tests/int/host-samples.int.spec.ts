import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { createArchitectureGet } from '@/app/api/architecture/route'
import type { ArchviewSourceRecord } from '@/utilities/archviewSources'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('host sampling on architecture cache fill', () => {
  let payload: Payload
  let sourceId: string
  let sourceName: string

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const source = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `sample-source-${Date.now()}`,
        origin: 'https://sample.example.test',
        audience: 'https://sample.example.test/api',
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })
    sourceId = String(source.id)
    sourceName = String(source.name)
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
    ({ id: sourceId, name: sourceName, origin: 'https://sample.example.test' }) as ArchviewSourceRecord

  const sampleCount = async () =>
    (
      await payload.find({
        collection: 'host-samples',
        where: { host: { equals: sourceId } },
        limit: 0,
        overrideAccess: true,
      })
    ).totalDocs

  it('writes one sample on a cache fill', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({
        telemetry: { metrics: { cpuAvg: 12, memoryPercent: 45, loadAvg: 0.7, diskPercent: 60 } },
      })
    }
    const GET = createArchitectureGet({
      env: {},
      fetchImpl,
      lookupSource: async () => null,
      lookupDefaultSource,
    })

    await GET(new Request('https://cms.example/api/architecture?project=p'))

    expect(calls).toBe(1)
    expect(await sampleCount()).toBe(1)
  })

  it('writes no sample on a cache hit', async () => {
    const before = await sampleCount()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({
        telemetry: { metrics: { cpuAvg: 12, memoryPercent: 45, loadAvg: 0.7, diskPercent: 60 } },
      })
    }
    const GET = createArchitectureGet({
      env: {},
      fetchImpl,
      lookupSource: async () => null,
      lookupDefaultSource,
    })

    await GET(new Request('https://cms.example/api/architecture?project=p2'))
    await GET(new Request('https://cms.example/api/architecture?project=p2&t=2'))

    expect(calls).toBe(1)
    expect(await sampleCount()).toBe(before + 1)
  })

  it('writes no sample on a throttled repeat within 60s', async () => {
    const before = await sampleCount()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({
        telemetry: { metrics: { cpuAvg: 12, memoryPercent: 45, loadAvg: 0.7, diskPercent: 60 } },
      })
    }
    const GET = createArchitectureGet({
      env: {},
      fetchImpl,
      lookupSource: async () => null,
      lookupDefaultSource,
    })

    await GET(new Request('https://cms.example/api/architecture?project=p3'))
    await new Promise((resolve) => setTimeout(resolve, 5200))
    await GET(new Request('https://cms.example/api/architecture?project=p3&t=2'))

    expect(calls).toBe(2)
    expect(await sampleCount()).toBe(before + 1)
  })

  it('writes no sample on a failed upstream', async () => {
    const before = await sampleCount()
    const fetchImpl: typeof fetch = async () => new Response('boom', { status: 500 })
    const GET = createArchitectureGet({
      env: {},
      fetchImpl,
      lookupSource: async () => null,
      lookupDefaultSource,
    })

    await GET(new Request('https://cms.example/api/architecture?project=p4'))

    expect(await sampleCount()).toBe(before)
  })
})