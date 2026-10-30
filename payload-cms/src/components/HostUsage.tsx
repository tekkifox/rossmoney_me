import React from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'

type SearchParams = Record<string, string | string[] | undefined> | Promise<Record<string, string | string[] | undefined>>

type Sample = {
  host?: number | string | { id?: string | number } | null
  hostLabel?: string | null
  sampledAt?: string | Date | null
  cpuAvg?: number | null
  memoryPercent?: number | null
  loadAvg?: number | null
  diskPercent?: number | null
}

type Bucket = {
  key: string
  label: string
  cpuAvg: number | null
  memoryPercent: number | null
  loadAvg: number | null
  diskPercent: number | null
  count: number
}

const RANGE_OPTIONS = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function rangeMs(range: string): number {
  if (range === '7d') return 7 * 24 * 60 * 60 * 1000
  if (range === '30d') return 30 * 24 * 60 * 60 * 1000
  return 24 * 60 * 60 * 1000
}

function bucketKey(date: Date, range: string): string {
  const d = new Date(date)
  if (range === '30d') {
    d.setUTCHours(0, 0, 0, 0)
  } else {
    d.setUTCMinutes(0, 0, 0)
  }
  return d.toISOString()
}

function bucketLabel(key: string, range: string): string {
  const d = new Date(key)
  if (range === '30d') {
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
  }
  return `${String(d.getUTCHours()).padStart(2, '0')}:00`
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

async function loadSamples(host: string | undefined, range: string): Promise<Sample[]> {
  const payload = await getPayload({ config })
  const now = Date.now()
  const cutoff = new Date(now - rangeMs(range)).toISOString()
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
  return (result.docs ?? []) as Sample[]
}

function groupByHost(samples: Sample[]): Map<string, Sample[]> {
  const map = new Map<string, Sample[]>()
  for (const sample of samples) {
    const label = sample.hostLabel ?? 'Unknown host'
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(sample)
  }
  return map
}

function aggregate(samples: Sample[], range: string): Bucket[] {
  const buckets = new Map<string, Sample[]>()
  for (const sample of samples) {
    if (!sample.sampledAt) continue
    const key = bucketKey(new Date(sample.sampledAt), range)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(sample)
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, items]) => ({
      key,
      label: bucketLabel(key, range),
      cpuAvg: average(items.map((s) => toNumber(s.cpuAvg))),
      memoryPercent: average(items.map((s) => toNumber(s.memoryPercent))),
      loadAvg: average(items.map((s) => toNumber(s.loadAvg))),
      diskPercent: average(items.map((s) => toNumber(s.diskPercent))),
      count: items.length,
    }))
}

function LineChart({ title, unit, buckets, color }: { title: string; unit: string; buckets: Bucket[]; color: string }) {
  const width = 480
  const height = 160
  const padLeft = 40
  const padRight = 10
  const padTop = 16
  const padBottom = 24
  const plotW = width - padLeft - padRight
  const plotH = height - padTop - padBottom

  const values = buckets.map((b) => {
    if (title.startsWith('CPU')) return b.cpuAvg
    if (title.startsWith('Memory')) return b.memoryPercent
    if (title.startsWith('Load')) return b.loadAvg
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

  const range = firstParam(actual.range) ?? '24h'
  const host = firstParam(actual.host)

  const payload = await getPayload({ config })
  const sourcesResult = await payload.find({
    collection: 'archview-sources',
    limit: 100,
    overrideAccess: true,
  })
  const sources = (sourcesResult.docs ?? []) as Array<{ id?: string | number; name?: string; isDefault?: boolean }>

  const samples = await loadSamples(host, range)
  const byHost = groupByHost(samples)

  // If no host filter and no samples, still show sources
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
        const hostSamples = byHost.get(label) ?? []
        const buckets = aggregate(hostSamples, range)
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