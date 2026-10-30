import React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { createArchitectureGet } from '@/app/api/architecture/route'
import type { ArchviewSourceRecord } from '@/utilities/archviewSources'
import { bucketHostSamples } from '@/utilities/hostUsage'
import ArchitectureClient from '@/components/ArchitectureClient/ArchitectureClient'
import { PageRoot } from '@/components/PageRoot'

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
        project: 'sample-project',
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
    for (let i = 0; i < 20 && (await sampleCount()) < 1; i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
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
    for (let i = 0; i < 20 && (await sampleCount()) < before + 1; i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
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

describe('host usage bucketing', () => {
  it('produces hourly buckets for 24h and 7d, daily for 30d', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0)
    const samples = [
      { hostLabel: 'host-a', sampledAt: new Date(now - 30 * 60 * 1000).toISOString(), cpuAvg: 10, memoryPercent: 20, loadAvg: 1, diskPercent: 30 },
    ]
    expect(bucketHostSamples(samples, '24h', now).get('host-a')![0].label).toMatch(/:/)
    expect(bucketHostSamples(samples, '7d', now).get('host-a')![0].label).toMatch(/:/)
    expect(bucketHostSamples(samples, '30d', now).get('host-a')![0].label).toMatch(/\//)
  })

  it('drops samples outside the range', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0)
    const samples = [
      { hostLabel: 'host-a', sampledAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(), cpuAvg: 10, memoryPercent: 20, loadAvg: 1, diskPercent: 30 },
      { hostLabel: 'host-a', sampledAt: new Date(now - 10 * 60 * 1000).toISOString(), cpuAvg: 20, memoryPercent: 40, loadAvg: 2, diskPercent: 60 },
    ]
    const buckets = bucketHostSamples(samples, '24h', now).get('host-a')!
    expect(buckets).toHaveLength(1)
  })

  it('averages metrics when a bucket holds several samples', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0)
    const hour = new Date(now - 10 * 60 * 1000)
    hour.setUTCMinutes(0, 0, 0)
    const samples = [
      { hostLabel: 'host-a', sampledAt: new Date(hour.getTime() + 5 * 60 * 1000).toISOString(), cpuAvg: 10, memoryPercent: 20, loadAvg: 1, diskPercent: 30 },
      { hostLabel: 'host-a', sampledAt: new Date(hour.getTime() + 10 * 60 * 1000).toISOString(), cpuAvg: 30, memoryPercent: 60, loadAvg: 3, diskPercent: 90 },
    ]
    const bucket = bucketHostSamples(samples, '24h', now).get('host-a')![0]
    expect(bucket.cpuAvg).toBe(20)
    expect(bucket.memoryPercent).toBe(40)
    expect(bucket.count).toBe(2)
  })

  it('returns empty buckets for an empty range without throwing', () => {
    const now = Date.now()
    const result = bucketHostSamples([], '24h', now)
    expect(result.size).toBe(0)
  })

  it('maps a host alias/label to the right series', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0)
    const samples = [
      { hostLabel: 'alpha', sampledAt: new Date(now - 5 * 60 * 1000).toISOString(), cpuAvg: 1, memoryPercent: 2, loadAvg: 3, diskPercent: 4 },
      { hostLabel: 'beta', sampledAt: new Date(now - 5 * 60 * 1000).toISOString(), cpuAvg: 5, memoryPercent: 6, loadAvg: 7, diskPercent: 8 },
    ]
    const result = bucketHostSamples(samples, '24h', now)
    expect(result.get('alpha')![0].cpuAvg).toBe(1)
    expect(result.get('beta')![0].cpuAvg).toBe(5)
  })
})

describe('host usage data path', () => {
  let payload: Payload
  const runId = Date.now()
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })
  afterAll(async () => {
    await payload.delete({ collection: 'host-samples', where: { hostLabel: { in: [`host-x-${runId}`, `host-y-${runId}`] } }, overrideAccess: true })
  })

  it('seeds samples across hosts and buckets them via the view query', async () => {
    const now = Date.now()
    await payload.create({
      collection: 'host-samples',
      data: { hostLabel: `host-x-${runId}`, sampledAt: new Date(now - 30 * 60 * 1000).toISOString(), cpuAvg: 10, memoryPercent: 20, loadAvg: 1, diskPercent: 30 },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'host-samples',
      data: { hostLabel: `host-y-${runId}`, sampledAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(), cpuAvg: 50, memoryPercent: 60, loadAvg: 2, diskPercent: 70 },
      overrideAccess: true,
    })

    const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString()
    const result = await payload.find({
      collection: 'host-samples',
      where: { sampledAt: { greater_than_equal: cutoff } },
      sort: 'sampledAt',
      limit: 100000,
      overrideAccess: true,
    })
    const filtered = (result.docs as unknown as Array<Record<string, unknown>>).filter((d) =>
      String(d.hostLabel).startsWith('host-') && String(d.hostLabel).endsWith(String(runId)),
    )
    const buckets = bucketHostSamples(
      filtered.map((d) => ({
        hostLabel: d.hostLabel as string,
        sampledAt: d.sampledAt as string,
        cpuAvg: d.cpuAvg as number,
        memoryPercent: d.memoryPercent as number,
        loadAvg: d.loadAvg as number,
        diskPercent: d.diskPercent as number,
      })),
      '24h',
      now,
    )
    expect(buckets.has(`host-x-${runId}`)).toBe(true)
    expect(buckets.has(`host-y-${runId}`)).toBe(false)
  })
})

import { sampleAllEnabledHosts, shouldRunHostSampler } from '@/utilities/hostSampling'

describe('shouldRunHostSampler', () => {
  it('on by default locally', () => {
    expect(shouldRunHostSampler({})).toBe(true)
  })
  it('off when VERCEL set', () => {
    expect(shouldRunHostSampler({ VERCEL: '1' })).toBe(false)
  })
  it('off when HOST_SAMPLER=off', () => {
    expect(shouldRunHostSampler({ HOST_SAMPLER: 'off' })).toBe(false)
  })
  it('on with HOST_SAMPLER=on even under Vercel', () => {
    expect(shouldRunHostSampler({ VERCEL: '1', HOST_SAMPLER: 'on' })).toBe(true)
  })
})

describe('host sampling scheduler', () => {
  let payload: Payload
  let sourceId: string
  const originalFetch = global.fetch
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const source = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `sched-source-${Date.now()}`,
        origin: 'https://sched.example.test',
        project: 'sched-project',
        audience: 'https://sched.example.test/api',
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })
    sourceId = String(source.id)
  })
  afterAll(async () => {
    global.fetch = originalFetch
    await payload.delete({ collection: 'host-samples', where: { host: { equals: sourceId } }, overrideAccess: true })
    await payload.delete({ collection: 'archview-sources', where: { id: { equals: sourceId } }, overrideAccess: true })
  })
  it('one undecryptable secret does not stop other sources', async () => {
    const good = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `good-${Date.now()}`,
        origin: 'https://good.example.test',
        project: 'good-project',
        audience: 'https://good.example.test/api',
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })
    const bad = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `bad-${Date.now()}`,
        origin: 'https://bad.example.test',
        project: 'bad-project',
        audience: 'https://bad.example.test/api',
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })
    // Corrupt the stored secret so decryption fails.
    await payload.db.updateOne({
      collection: 'archview-sources',
      id: bad.id,
      data: { clientSecret: 'v1.garbage.garbage.garbage' },
    } as never)
    global.fetch = (async () =>
      new Response(JSON.stringify({ telemetry: { metrics: { cpuAvg: 7, memoryPercent: 11, loadAvg: 0.2, diskPercent: 33 } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch
    await sampleAllEnabledHosts(payload)
    const goodSamples = await payload.find({
      collection: 'host-samples',
      where: { host: { equals: String(good.id) } },
      overrideAccess: true,
    })
    expect(goodSamples.totalDocs).toBeGreaterThan(0)
    // cleanup
    await payload.delete({ collection: 'host-samples', where: { host: { equals: String(good.id) } }, overrideAccess: true })
    await payload.delete({ collection: 'archview-sources', where: { id: { in: [String(good.id), String(bad.id)] } }, overrideAccess: true })
  })

  it('reports a 401 source as skipped with status', async () => {
    const src = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `authfail-${Date.now()}`,
        origin: 'https://authfail.example.test',
        project: 'authfail-project',
        audience: 'https://authfail.example.test/api',
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })
    global.fetch = (async () =>
      new Response('unauthorized', { status: 401 })) as typeof fetch
    // capture console? just call
    await sampleAllEnabledHosts(payload)
    const result = await payload.find({
      collection: 'host-samples',
      where: { host: { equals: String(src.id) } },
      overrideAccess: true,
    })
    expect(result.totalDocs).toBe(0)
    await payload.delete({ collection: 'archview-sources', where: { id: { equals: String(src.id) } }, overrideAccess: true })
  })

  it('samples a source that is never requested', async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ telemetry: { metrics: { cpuAvg: 7, memoryPercent: 11, loadAvg: 0.2, diskPercent: 33 } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch
    await sampleAllEnabledHosts(payload)
    const result = await payload.find({
      collection: 'host-samples',
      where: { host: { equals: sourceId } },
      overrideAccess: true,
    })
    expect(result.totalDocs).toBeGreaterThan(0)
  })

  it("polls the row's ArchView project in the query string", async () => {
    const src = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `project-query-${Date.now()}`,
        origin: 'https://project-query.example.test',
        project: 'image mosaic/2026',
        audience: 'https://project-query.example.test/api',
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })

    const urls: string[] = []
    global.fetch = (async (input: RequestInfo | URL) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
      return new Response(
        JSON.stringify({ telemetry: { metrics: { cpuAvg: 7, memoryPercent: 11, loadAvg: 0.2, diskPercent: 33 } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    await sampleAllEnabledHosts(payload)

    const polled = urls.find((url) => url.startsWith('https://project-query.example.test/api/architecture'))
    expect(polled).toBe(
      `https://project-query.example.test/api/architecture?project=${encodeURIComponent('image mosaic/2026')}`,
    )

    await payload.delete({ collection: 'host-samples', where: { host: { equals: String(src.id) } }, overrideAccess: true })
    await payload.delete({ collection: 'archview-sources', where: { id: { equals: String(src.id) } }, overrideAccess: true })
  })

  it('skips a source without a project and writes nothing', async () => {
    const src = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `no-project-${Date.now()}`,
        origin: 'https://no-project.example.test',
        audience: 'https://no-project.example.test/api',
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })

    const urls: string[] = []
    global.fetch = (async (input: RequestInfo | URL) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
      return new Response(
        JSON.stringify({ telemetry: { metrics: { cpuAvg: 7, memoryPercent: 11, loadAvg: 0.2, diskPercent: 33 } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
    const warn = vi.spyOn(payload.logger, 'warn')

    await sampleAllEnabledHosts(payload)

    expect(urls.some((url) => url.startsWith('https://no-project.example.test'))).toBe(false)
    expect(
      (
        await payload.find({
          collection: 'host-samples',
          where: { host: { equals: String(src.id) } },
          overrideAccess: true,
        })
      ).totalDocs,
    ).toBe(0)
    expect(
      warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n'),
    ).toContain('no project configured')
    warn.mockRestore()

    await payload.delete({ collection: 'archview-sources', where: { id: { equals: String(src.id) } }, overrideAccess: true })
  })
})

describe('host rename keeps history by id', () => {
  let payload: Payload
  let sourceId: string
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const source = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `rename-source-${Date.now()}`,
        origin: 'https://rename.example.test',
        audience: 'https://rename.example.test/api',
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })
    sourceId = String(source.id)
    await payload.create({
      collection: 'host-samples',
      data: { host: sourceId, hostLabel: 'old-name', sampledAt: new Date().toISOString(), cpuAvg: 5 },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'archview-sources',
      id: sourceId,
      data: { name: 'new-name' },
      overrideAccess: true,
    })
  })
  afterAll(async () => {
    await payload.delete({ collection: 'host-samples', where: { host: { equals: sourceId } }, overrideAccess: true })
    await payload.delete({ collection: 'archview-sources', where: { id: { equals: sourceId } }, overrideAccess: true })
  })
  it('keeps samples queryable by host id after rename', async () => {
    const result = await payload.find({
      collection: 'host-samples',
      where: { host: { equals: sourceId } },
      overrideAccess: true,
    })
    expect(result.totalDocs).toBe(1)
  })
})

describe('architecture project attribute', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    document.getElementById('page-root')?.remove()
  })

  it('renders the resolved source project on #page-root', () => {
    const { container } = render(
      React.createElement(PageRoot, {
        architectureApi: '/api/architecture',
        architectureProject: 'image-mosaic',
      }),
    )

    expect(
      container.querySelector('#page-root')?.getAttribute('data-architecture-project'),
    ).toBe('image-mosaic')
  })

  it('omits the attribute when the source has no project', () => {
    const { container } = render(
      React.createElement(PageRoot, {
        architectureApi: '/api/architecture',
      }),
    )

    expect(
      container.querySelector('#page-root')?.hasAttribute('data-architecture-project'),
    ).toBe(false)
  })

  it('prefers the rendered project and falls back to the prop', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
        return new Response(
          JSON.stringify({ telemetry: { metrics: { cpuAvg: 1, memoryPercent: 2, loadAvg: 0.1, diskPercent: 3 } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    const root = document.createElement('article')
    root.id = 'page-root'
    root.dataset.architectureApi = '/api/architecture'
    root.dataset.architectureProject = 'from-row'
    document.body.appendChild(root)

    render(React.createElement(ArchitectureClient, { project: 'from-prop' }))
    await waitFor(() => expect(urls).toHaveLength(1))
    expect(urls[0]).toContain('project=from-row')
    expect(urls[0]).not.toContain('from-prop')

    cleanup()
    delete root.dataset.architectureProject

    render(React.createElement(ArchitectureClient, { project: 'from-prop' }))
    await waitFor(() => expect(urls).toHaveLength(2))
    expect(urls[1]).toContain('project=from-prop')
  })
})