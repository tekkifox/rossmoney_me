import React from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  HOST_USAGE_RANGE_MS,
  RECENT_SAMPLE_WINDOW_MS,
  RECENT_SAMPLES_LIMIT,
  bucketHostSamples,
  hostIdOf,
  recentHostSamples,
  selectHostUsageSource,
  type HostUsageRange,
  type HostSample,
  type HostRef,
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
  host?: HostRef
  hostLabel?: string | null
  sampledAt?: string | Date | null
  cpuAvg?: number | null
  memoryPercent?: number | null
  loadAvg?: number | null
  diskPercent?: number | null
}

type Source = {
  id: string
  name: string
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function isRange(value: string | undefined): value is HostUsageRange {
  return value === '1h' || value === '24h' || value === '7d' || value === '30d'
}

function hostHref(host: string, range: HostUsageRange): string {
  return `?${new URLSearchParams({ host, range }).toString()}`
}

async function loadSamples(host: string | undefined, range: HostUsageRange, now: number) {
  const payload = await getPayload({ config })
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
      depth: 0,
      overrideAccess: true,
    })
    all.push(...((result.docs ?? []) as SampleRow[]))
    if (!result.hasNextPage) break
    page += 1
  }
  return all
}

/**
 * The sources that have at least one sample in the selected range.
 *
 * One grouped query, not one per source: the default tab must not cost the page
 * a fan-out. The result is only used when the request does not already name an
 * existing source.
 */
async function loadHostsWithSamples(range: HostUsageRange, now: number): Promise<Set<string>> {
  const payload = await getPayload({ config })
  const cutoff = new Date(now - HOST_USAGE_RANGE_MS[range]).toISOString()
  const result = await payload.findDistinct({
    collection: 'host-samples',
    field: 'host',
    where: { sampledAt: { greater_than_equal: cutoff } },
    depth: 0,
    overrideAccess: true,
  })

  const hosts = new Set<string>()
  for (const row of result.values as Array<{ host?: HostRef }>) {
    const id = hostIdOf(row.host)
    if (id) hosts.add(id)
  }
  return hosts
}

/**
 * The table below the graph is always the last 15 minutes, whatever the range
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
    depth: 0,
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
  const requestedHost = firstParam(actual.host)

  const payload = await getPayload({ config })
  const sourcesResult = await payload.find({
    collection: 'archview-sources',
    limit: 100,
    overrideAccess: true,
  })
  const sources: Source[] = (
    (sourcesResult.docs ?? []) as Array<{ id?: string | number; name?: string }>
  )
    .filter((source) => source.id !== undefined && source.id !== null)
    .map((source) => ({ id: String(source.id), name: source.name ?? String(source.id) }))

  const now = Date.now()

  // An explicit host that still exists always wins. Otherwise open on the first
  // source with samples in this range, so the newest configured source cannot
  // leave the page blank just because it has never reported. There is
  // deliberately no "all hosts" selection: one host at a time keeps the page
  // short. The grouped query only runs when the fallback is actually needed.
  let selectedSource = sources.find((source) => source.id === requestedHost)
  if (!selectedSource && sources.length > 0) {
    const hostsWithSamples = await loadHostsWithSamples(range, now)
    selectedSource = selectHostUsageSource(sources, undefined, hostsWithSamples)
  }
  const selectedHost = selectedSource?.id

  const docs = selectedHost ? await loadSamples(selectedHost, range, now) : []
  const recentDocs = selectedHost ? await loadRecentSamples(selectedHost, now) : []

  const samples = docs.map((d) => ({
    host: hostIdOf(d.host),
    hostLabel: d.hostLabel as string | null,
    sampledAt: d.sampledAt as string | Date | null,
    cpuAvg: d.cpuAvg as number | null,
    memoryPercent: d.memoryPercent as number | null,
    loadAvg: d.loadAvg as number | null,
    diskPercent: d.diskPercent as number | null,
  })) as unknown as HostSample[]

  const byHost = bucketHostSamples(samples, range, now)

  // Always the last 15 minutes, independent of the range selector. The helper
  // drops stale rows, applies the host filter, sorts newest first and caps the
  // list so a bad sampler cadence cannot render an unbounded table.
  const recent = recentHostSamples(recentDocs as unknown as HostSample[], {
    now,
    host: selectedHost,
    limit: RECENT_SAMPLES_LIMIT,
  })

  const rangeLabel = RANGE_OPTIONS.find((r) => r.value === range)?.label ?? range
  const buckets = selectedHost ? (byHost.get(selectedHost) ?? []) : []
  const data = buckets.map((b) => ({
    label: b.label,
    cpuAvg: b.cpuAvg,
    memoryPercent: b.memoryPercent,
    loadAvg: b.loadAvg,
    diskPercent: b.diskPercent,
  }))

  return (
    <div className="host-usage" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1>Host usage</h1>

      {sources.length > 0 && (
        <nav
          aria-label="Hosts"
          style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}
        >
          {sources.map((source) => {
            const selected = source.id === selectedHost
            return (
              <a
                key={source.id}
                href={hostHref(source.id, range)}
                aria-current={selected ? 'page' : undefined}
                className="btn btn--style-tab btn--size-medium"
                style={
                  selected
                    ? {
                        backgroundColor: 'var(--theme-elevation-100)',
                        fontWeight: 600,
                      }
                    : undefined
                }
              >
                {source.name}
              </a>
            )
          })}
        </nav>
      )}

      <form method="get" style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {selectedHost && <input type="hidden" name="host" value={selectedHost} />}
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

      {sources.length === 0 && <p>No hosts configured.</p>}

      {selectedSource && (
        <section style={{ marginBottom: 32 }}>
          <h2>{selectedSource.name}</h2>
          {buckets.length === 0 ? (
            <p>No samples in the selected range ({rangeLabel}).</p>
          ) : (
            <HostUsageChart data={data} />
          )}
        </section>
      )}

      {selectedSource && (
        <section>
          <h2>Last 15 minutes</h2>
          <p style={{ color: 'var(--theme-elevation-600)', marginBottom: 8 }}>
            Newest first; times are UTC. Capped at the {RECENT_SAMPLES_LIMIT} most recent samples so
            a bad sampler cadence cannot render an unbounded list.
          </p>
          {recent.length === 0 ? (
            <p>No samples in the last 15 minutes.</p>
          ) : (
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
                  {recent.map((row, index) => (
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
          )}
        </section>
      )}
    </div>
  )
}
