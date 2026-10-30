import React from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'
import { bucketHostSamples, type HostUsageRange } from '@/utilities/hostUsage'

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
    where.hostLabel = { equals: host }
  }
  const result = await payload.find({
    collection: 'host-samples',
    where: where as never,
    sort: 'sampledAt',
    limit: 100000,
    overrideAccess: true,
  })
  return { payload, docs: (result.docs ?? []) as Array<Record<string, unknown>>, now }
}

function LineChart({ title, unit, buckets, color }: { title: string; unit: string; buckets: { cpuAvg: number | null; memoryPercent: number | null; loadAvg: number | null; diskPercent: number | null; label: string }[]; color: string }) {
  const width = 480
  const height = 160
  const padLeft = 40
  const padRight = 10
  const padTop = 16
  const padBottom = 24
  const plotW = width - padLeft - padRight
  const plotH = height - padTop - padBottom

  const values = buckets.map((b) => {
    if (title === 'CPU') return b.cpuAvg
    if (title === 'Memory') return b.memoryPercent
    if (title === 'Load') return b.loadAvg
    return b.diskPercent
  })

  const finite = values.filter((v): v is number => v !== null)
  const min = finite.length ? Math.min(...finite) : 0
  const max = finite.length ? Math.max(...finite) : 1
  const lo = Math.min(min, 0)
  const hi = Math.max(max, 1)

  const points = values
    .map((v, i) => {
      if (v === null) return null
      const x = padLeft + (i / Math.max(buckets.length - 1, 1)) * plotW
      const y = padTop + (1 - (v - lo) / (hi - lo)) * plotH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .filter(Boolean)
    .join(' ')

  const yTicks = [lo, (lo + hi) / 2, hi]

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 600, marginBottom: 4 }}>
        {title} ({unit})
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" aria-label={title}>
        <rect x={0} y={0} width={width} height={height} fill="none" stroke="var(--color-border)" />
        {yTicks.map((t, i) => {
          const y = padTop + (1 - (t - lo) / (hi - lo)) * plotH
          return (
            <g key={i}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize={10}>
                {t.toFixed(1)}
              </text>
            </g>
          )
        })}
        <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
        {buckets.length > 0 && (
          <>
            <text x={padLeft} y={height - 6} fontSize={10}>
              {buckets[0].label}
            </text>
            <text x={width - padRight} y={height - 6} textAnchor="end" fontSize={10}>
              {buckets[buckets.length - 1].label}
            </text>
          </>
        )}
      </svg>
    </figure>
  )
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
    hostLabel: d.hostLabel as string | null,
    sampledAt: d.sampledAt as string | Date | null,
    cpuAvg: d.cpuAvg as number | null,
    memoryPercent: d.memoryPercent as number | null,
    loadAvg: d.loadAvg as number | null,
    diskPercent: d.diskPercent as number | null,
  }))

  const byHost = bucketHostSamples(samples, range, now)

  const hostLabels = host
    ? [host]
    : sources.map((s) => s.name).filter(Boolean) as string[]

  const colors = ['var(--primary)']

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1>Host usage</h1>
      <form method="get" style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label>
          Host:{' '}
          <select name="host" defaultValue={host ?? ''}>
            <option value="">All hosts</option>
            {sources.map((s) => (
              <option key={String(s.id)} value={s.name ?? ''}>
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

      {hostLabels.map((label, idx) => {
        const buckets = byHost.get(label) ?? []
        const color = colors[idx % colors.length]
        return (
          <section key={label} style={{ marginBottom: 32 }}>
            <h2>{label}</h2>
            {buckets.length === 0 ? (
              <p>No samples in range.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: 16 }}>
                <LineChart title="CPU" unit="%" buckets={buckets} color={color} />
                <LineChart title="Memory" unit="%" buckets={buckets} color={color} />
                <LineChart title="Load" unit="load avg" buckets={buckets} color={color} />
                <LineChart title="Disk" unit="%" buckets={buckets} color={color} />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}