import React from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  HOST_USAGE_RANGE_MS,
  RECENT_SAMPLE_WINDOW_MS,
  RECENT_SAMPLES_LIMIT,
  bucketHostSamples,
  recentHostSamples,
  type HostUsageRange,
  type HostSample,
  type RecentHostSample,
} from '@/utilities/hostUsage'
import { HostUsageChart } from './HostUsageChart'

type SearchParams = Record<string, string | string[] | undefined> | Promise<Record<string, string | string[] | undefined>>

const RANGE_OPTIONS = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

type SampleRow = {
  host?: string | number | null
  hostLabel?: string | null
  sampledAt?: string | Date | null
  cpuAvg?: number | null
  memoryPercent?: number | null
  loadAvg?: number | null
  diskPercent?: number | null
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function isRange(value: string | undefined): value is HostUsageRange {
  return value === '1h' || value === '24h' || value === '7d' || value === '30d'
}

async function loadSamples(host: string | undefined, range: HostUsageRange) {
  const payload = await getPayload({ config })
  const now = Date.now()
  const cutoff = new Date(now - HOST_USAGE_RANGE_MS[range]).toISOString()
  const where: Record<string, unknown> = {
    sampledAt: { greater_than_equal: cutoff },
  }
  if (host) {
    where.host = { equals: host }
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

/**
 * The table below the graphs is always the last 15 minutes, whatever the range
 * selector says, so it queries separately and caps the result.
 */
async function loadRecentSamples(host: string | undefined, now: number) {
  const payload = await getPayload({ config })
  const cutoff = new Date(now - RECENT_SAMPLE_WINDOW_MS).toISOString()
  const where: Record<string, unknown> = {
    sampledAt: { greater_than_equal: cutoff },
  }
  if (host) {
    where.host = { equals: host }
  }
  const result = await payload.find({
    collection: 'host-samples',
    where: where as never,
    sort: '-sampledAt',
    limit: RECENT_SAMPLES_LIMIT,
    page: 1,
    overrideAccess: true,
  })
  return (result.docs ?? []) as SampleRow[]
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
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
  const recentDocs = await loadRecentSamples(host, now)
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
  })) as unknown as HostSample[]

  const byHost = bucketHostSamples(samples, range, now)

  const hostLabels = host
    ? [host]
    : sources.map((s) => String(s.id)).filter(Boolean)

  // Always the last 15 minutes, independent of the range selector. The helper
  // drops stale rows, applies the host filter, sorts newest first and caps the
  // list so a bad sampler cadence cannot render an unbounded table.
  const recent = recentHostSamples(recentDocs as unknown as HostSample[], {
    now,
    host,
    limit: RECENT_SAMPLES_LIMIT,
  })

  const sourceName = (rowHost: string | null, hostLabel: string): string =>
    (rowHost ? sources.find((s) => String(s.id) === rowHost)?.name : undefined) ?? hostLabel

  // The selector is already newest-first, so each group keeps that order.
  const recentByHost = new Map<string, RecentHostSample[]>()
  for (const row of recent) {
    const key = row.host ?? row.hostLabel
    const rows = recentByHost.get(key)
    if (rows) rows.push(row)
    else recentByHost.set(key, [row])
  }

  const rangeLabel = RANGE_OPTIONS.find((r) => r.value === range)?.label ?? range

  return (
    <div className="host-usage" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
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
        const name = sources.find((s) => String(s.id) === label)?.name ?? label
        const data = buckets.map((b) => ({
          label: b.label,
          cpuAvg: b.cpuAvg,
          memoryPercent: b.memoryPercent,
          loadAvg: b.loadAvg,
          diskPercent: b.diskPercent,
        }))
        return (
          <section key={label} style={{ marginBottom: 32 }}>
            <h2>{name}</h2>
            {buckets.length === 0 ? (
              <p>No samples in the selected range ({rangeLabel}).</p>
            ) : (
              <HostUsageChart data={data} />
            )}
          </section>
        )
      })}

      <section style={{ marginTop: 32 }}>
        <h2>Last 15 minutes</h2>
        <p style={{ color: 'var(--theme-elevation-600)', marginBottom: 8 }}>
          Grouped by host, newest first; times are UTC. Capped at the {RECENT_SAMPLES_LIMIT}{' '}
          most recent samples in total across hosts so a bad sampler cadence cannot render
          an unbounded list.
        </p>
        {recentByHost.size === 0 ? (
          <p>No samples in the last 15 minutes.</p>
        ) : (
          Array.from(recentByHost.entries()).map(([key, rows]) => (
            <div key={key} style={{ marginTop: 16 }}>
              <h3>{sourceName(rows[0].host, rows[0].hostLabel)}</h3>
              <div className="table table--appearance-condensed">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Time (UTC)</th>
                      <th scope="col">CPU %</th>
                      <th scope="col">Memory %</th>
                      <th scope="col">Load</th>
                      <th scope="col">Disk %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${row.time}-${index}`}>
                        <td>{row.time}</td>
                        <td>{formatMetric(row.cpuAvg)}</td>
                        <td>{formatMetric(row.memoryPercent)}</td>
                        <td>{formatMetric(row.loadAvg)}</td>
                        <td>{formatMetric(row.diskPercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
