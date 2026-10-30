import React from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'
import { bucketHostSamples, type HostUsageRange } from '@/utilities/hostUsage'
import { HostUsageChart } from './HostUsageChart'

type SearchParams = Record<string, string | string[] | undefined> | Promise<Record<string, string | string[] | undefined>>

const RANGE_OPTIONS = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function isRange(value: string | undefined): value is HostUsageRange {
  return value === '24h' || value === '7d' || value === '30d'
}

async function loadSamples(host: string | undefined, range: HostUsageRange) {
  const payload = await getPayload({ config })
  const { HOST_USAGE_RANGE_MS } = await import('@/utilities/hostUsage')
  const now = Date.now()
  const cutoff = new Date(now - HOST_USAGE_RANGE_MS[range]).toISOString()
  const where: Record<string, unknown> = {
    sampledAt: { greater_than_equal: cutoff },
  }
  if (host) {
    where.host = { equals: host }
  }
  type SampleRow = {
    host?: string | number | null
    hostLabel?: string | null
    sampledAt?: string | Date | null
    cpuAvg?: number | null
    memoryPercent?: number | null
    loadAvg?: number | null
    diskPercent?: number | null
  }
  const all: SampleRow[] = []
  let page = 1
  while (true) {
    const result = await payload.find({
      collection: 'host-samples',
      where: where as never,
      sort: 'sampledAt',
      limit: 1000,
      page,
      overrideAccess: true,
    })
    all.push(...((result.docs ?? []) as SampleRow[]))
    if (!result.hasNextPage) break
    page += 1
  }
  return { payload, docs: all, now }
}

export default async function HostUsage(props: { searchParams?: SearchParams }) {
  const actual =
    typeof (props?.searchParams as { then?: unknown })?.then === 'function'
      ? await (props.searchParams as Promise<Record<string, string | string[] | undefined>>)
      : ((props?.searchParams as Record<string, string | string[] | undefined>) ?? {})

  const rangeInput = firstParam(actual.range)
  const range: HostUsageRange = isRange(rangeInput) ? rangeInput : '24h'
  const host = firstParam(actual.host)

  const { payload, docs, now } = await loadSamples(host, range)
  const sourcesResult = await payload.find({
    collection: 'archview-sources',
    limit: 100,
    overrideAccess: true,
  })
  const sources = (sourcesResult.docs ?? []) as Array<{ id?: string | number; name?: string }>

  const samples = docs.map((d) => ({
    host: d.host as string | number | null,
    hostLabel: d.hostLabel as string | null,
    sampledAt: d.sampledAt as string | Date | null,
    cpuAvg: d.cpuAvg as number | null,
    memoryPercent: d.memoryPercent as number | null,
    loadAvg: d.loadAvg as number | null,
    diskPercent: d.diskPercent as number | null,
  })) as unknown as Parameters<typeof bucketHostSamples>[0]

  const byHost = bucketHostSamples(samples, range, now)

  const hostLabels = host
    ? [host]
    : sources.map((s) => String(s.id)).filter(Boolean)

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1>Host usage</h1>
      <form method="get" style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label>
          Host:{' '}
          <select name="host" defaultValue={host ?? ''}>
            <option value="">All hosts</option>
            {sources.map((s) => (
              <option key={String(s.id)} value={String(s.id)}>
                {s.name ?? s.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Range:{' '}
          <select name="range" defaultValue={range}>
            {RANGE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>

      {hostLabels.length === 0 && <p>No hosts configured.</p>}

      {hostLabels.map((label) => {
        const buckets = byHost.get(label) ?? []
        const sourceName = sources.find((s) => String(s.id) === label)?.name ?? label
        const data = buckets.map((b) => ({
          label: b.label,
          cpuAvg: b.cpuAvg,
          memoryPercent: b.memoryPercent,
          loadAvg: b.loadAvg,
          diskPercent: b.diskPercent,
        }))
        return (
          <section key={label} style={{ marginBottom: 32 }}>
            <h2>{sourceName}</h2>
            {buckets.length === 0 ? (
              <p>No samples in range.</p>
            ) : (
              <HostUsageChart data={data} />
            )}
          </section>
        )
      })}
    </div>
  )
}