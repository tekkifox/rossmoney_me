import { cleanup, render, screen, within } from '@testing-library/react'
import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import HostUsage from '@/components/HostUsage'
import { seriesDomain, type SeriesPoint } from '@/components/HostUsageChart'
import config from '@/payload.config'
import {
  bucketHostSamples,
  hostIdOf,
  recentHostSamples,
  type HostRef,
  type HostSample,
} from '@/utilities/hostUsage'

type Source = { id: string; name: string }

const runId = Date.now()
const RELATIONSHIP_OFFSET_MS = 60 * 1000

let payload: Payload
const sources: Source[] = []

const sampleFor = (source: Source) => ({
  host: source.id,
  hostLabel: source.name,
  sampledAt: new Date(Date.now() - RELATIONSHIP_OFFSET_MS).toISOString(),
  cpuAvg: 12,
  memoryPercent: 34,
  loadAvg: 0.5,
  diskPercent: 56,
})

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  for (const suffix of ['alpha', 'beta', 'gamma']) {
    const source = await payload.create({
      collection: 'archview-sources',
      data: {
        name: `usage-view-${suffix}-${runId}`,
        origin: `https://${suffix}.example.test`,
        project: `usage-view-${suffix}`,
        audience: `https://${suffix}.example.test/api`,
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
      } as RequiredDataFromCollectionSlug<'archview-sources'>,
      overrideAccess: true,
    })
    const entry: Source = { id: String(source.id), name: String(source.name) }
    sources.push(entry)
    await payload.create({
      collection: 'host-samples',
      data: sampleFor(entry) as never,
      overrideAccess: true,
    })
  }
})

afterAll(async () => {
  const ids = sources.map((source) => source.id)
  await payload.delete({
    collection: 'host-samples',
    where: { host: { in: ids } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'archview-sources',
    where: { id: { in: ids } },
    overrideAccess: true,
  })
})

afterEach(cleanup)

const point = (overrides: Partial<SeriesPoint>): SeriesPoint => ({
  label: '00:00',
  cpuAvg: null,
  memoryPercent: null,
  loadAvg: null,
  diskPercent: null,
  ...overrides,
})

describe('per-metric chart scales', () => {
  it('pads a metric to its own range so small variation fills the panel', () => {
    expect(
      seriesDomain([point({ cpuAvg: 29 }), point({ cpuAvg: 53 })], 'cpuAvg', true),
    ).toEqual([25.4, 56.6])
  })

  it('gives a constant series a readable band instead of a degenerate axis', () => {
    expect(
      seriesDomain([point({ diskPercent: 80.3 }), point({ diskPercent: 80.29999999999998 })], 'diskPercent', true),
    ).toEqual([79.3, 81.3])
  })

  it('keeps percent metrics inside 0–100', () => {
    expect(
      seriesDomain([point({ memoryPercent: 99 }), point({ memoryPercent: 100 })], 'memoryPercent', true),
    ).toEqual([98.85, 100])
  })
})

describe('host usage with populated relationships', () => {
  it('groups a populated host relationship under the source id and yields chart data', async () => {
    const source = sources[0]
    const result = await payload.find({
      collection: 'host-samples',
      where: { host: { equals: source.id } },
      depth: 2,
      limit: 1,
      overrideAccess: true,
    })
    const doc = result.docs[0] as unknown as Record<string, unknown>

    // Premise: without depth: 0 Payload hands back a populated document.
    expect(typeof doc.host).toBe('object')
    expect(hostIdOf(doc.host as HostRef)).toBe(source.id)

    const samples: HostSample[] = result.docs.map((row) => {
      const sample = row as unknown as Record<string, unknown>
      return {
        host: sample.host as HostRef,
        hostLabel: sample.hostLabel as string,
        sampledAt: sample.sampledAt as string,
        cpuAvg: sample.cpuAvg as number,
        memoryPercent: sample.memoryPercent as number,
        loadAvg: sample.loadAvg as number,
        diskPercent: sample.diskPercent as number,
      }
    })
    const now = Date.now()

    const byHost = bucketHostSamples(samples, '1h', now)
    expect(byHost.get(source.id)).toHaveLength(1)
    expect(byHost.get(source.id)?.[0].count).toBe(1)

    const rows = recentHostSamples(samples, { now, host: source.id })
    expect(rows).toHaveLength(1)
    expect(rows[0].host).toBe(source.id)
  })
})

describe('host usage view with three hosts', () => {
  it('renders a chart and a grouped table for every host', async () => {
    const ui = await HostUsage({ searchParams: { range: '1h' } })
    render(ui)

    for (const source of sources) {
      const chartHeading = screen.getByRole('heading', { level: 2, name: source.name })
      const section = chartHeading.closest('section')

      expect(section).not.toBeNull()
      expect(within(section as HTMLElement).queryByText(/No samples in the selected range/)).toBeNull()

      // Stacked small multiples: one chart panel per metric, each with its own
      // ResponsiveContainer and Y-axis rather than one shared percent axis.
      expect(section?.querySelectorAll('.recharts-responsive-container')).toHaveLength(4)
      const panelTitles = Array.from(section?.querySelectorAll('h3') ?? []).map(
        (heading) => heading.textContent,
      )
      expect(panelTitles).toEqual(['CPU %', 'Memory %', 'Load', 'Disk %'])

      const tableHeading = screen.getByRole('heading', { level: 3, name: source.name })
      const group = tableHeading.parentElement as HTMLElement
      expect(within(group).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
        'Time (UTC)',
        'CPU %',
        'Memory %',
        'Load',
        'Disk %',
      ])
      expect(within(group).getAllByRole('row')).toHaveLength(2)
    }
  })
})
