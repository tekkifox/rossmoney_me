export type HostUsageRange = '1h' | '24h' | '7d' | '30d'

export type HostSample = {
  host?: string | number | null
  hostLabel?: string | null
  sampledAt?: string | Date | null
  cpuAvg?: number | string | null
  memoryPercent?: number | string | null
  loadAvg?: number | string | null
  diskPercent?: number | string | null
}

export type HostUsageBucket = {
  key: string
  label: string
  cpuAvg: number | null
  memoryPercent: number | null
  loadAvg: number | null
  diskPercent: number | null
  count: number
}

/**
 * Cadence of the host sampler (see payload.config.ts). The graphs bucket hourly
 * for 24h/7d, so 3 minutes gives 20 points an hour — plenty of detail — while
 * keeping writes modest on a 1-ECPU database.
 */
export const SAMPLER_INTERVAL_MS = 3 * 60 * 1000

/**
 * Bucket width for the "last hour" graph. Deliberately equal to
 * SAMPLER_INTERVAL_MS: with one sample every 3 minutes each bucket holds exactly
 * one sample, so the two move together. Do not widen this to 5 minutes — a
 * 5-minute bucket holds one or two samples, so consecutive points average
 * different populations, the line wobbles from arithmetic alone, and a short
 * spike gets diluted.
 */
export const HOST_USAGE_BUCKET_MS = SAMPLER_INTERVAL_MS

export const HOST_USAGE_RANGE_MS: Record<HostUsageRange, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

/** The "last 15 minutes" table is independent of the graph range. */
export const RECENT_SAMPLE_WINDOW_MS = 15 * 60 * 1000

/**
 * Upper bound for the recent table. The sampler normally leaves ~5 samples per
 * host in 15 minutes; the cap keeps a runaway cadence from rendering an
 * unbounded list.
 */
export const RECENT_SAMPLES_LIMIT = 100

export type RecentHostSample = {
  time: string
  host: string | null
  hostLabel: string
  cpuAvg: number | null
  memoryPercent: number | null
  loadAvg: number | null
  diskPercent: number | null
}

export type RecentSampleOptions = {
  now?: number
  host?: string
  limit?: number
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

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function sampleTime(date: Date): string {
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
}

export function bucketKeyFor(date: Date, range: HostUsageRange): string {
  const d = new Date(date)
  if (range === '30d') {
    d.setUTCHours(0, 0, 0, 0)
  } else if (range === '1h') {
    // Hour-aligned 3-minute steps: 00, 03, ... 57.
    const stepMinutes = HOST_USAGE_BUCKET_MS / (60 * 1000)
    d.setUTCMinutes(Math.floor(d.getUTCMinutes() / stepMinutes) * stepMinutes, 0, 0)
  } else {
    d.setUTCMinutes(0, 0, 0)
  }
  return d.toISOString()
}

export function bucketLabelFor(key: string, range: HostUsageRange): string {
  const d = new Date(key)
  if (range === '30d') {
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
  }
  if (range === '1h') {
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  }
  return `${pad2(d.getUTCHours())}:00`
}

export function bucketHostSamples(
  samples: HostSample[],
  range: HostUsageRange,
  now: number = Date.now(),
): Map<string, HostUsageBucket[]> {
  const cutoff = now - HOST_USAGE_RANGE_MS[range]
  const grouped = new Map<string, HostSample[]>()

  for (const sample of samples) {
    if (!sample.sampledAt) continue
    const time = new Date(sample.sampledAt).getTime()
    if (!Number.isFinite(time) || time < cutoff) continue
    const label = (sample.host !== null && sample.host !== undefined ? String(sample.host) : sample.hostLabel) ?? 'Unknown host'
    if (!grouped.has(label)) grouped.set(label, [])
    grouped.get(label)!.push(sample)
  }

  const result = new Map<string, HostUsageBucket[]>()
  for (const [label, items] of grouped) {
    const buckets = new Map<string, HostSample[]>()
    for (const sample of items) {
      const key = bucketKeyFor(new Date(sample.sampledAt as string | Date), range)
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(sample)
    }
    const aggregated = Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, bucketItems]) => ({
        key,
        label: bucketLabelFor(key, range),
        cpuAvg: average(bucketItems.map((s) => toNumber(s.cpuAvg))),
        memoryPercent: average(bucketItems.map((s) => toNumber(s.memoryPercent))),
        loadAvg: average(bucketItems.map((s) => toNumber(s.loadAvg))),
        diskPercent: average(bucketItems.map((s) => toNumber(s.diskPercent))),
        count: bucketItems.length,
      }))
    result.set(label, aggregated)
  }

  return result
}

/**
 * Selects the rows for the "last 15 minutes" table: drops samples outside the
 * window, optionally keeps one host, sorts newest first, and caps the result.
 */
export function recentHostSamples(
  samples: HostSample[],
  options: RecentSampleOptions = {},
): RecentHostSample[] {
  const { now = Date.now(), host, limit = RECENT_SAMPLES_LIMIT } = options
  const cutoff = now - RECENT_SAMPLE_WINDOW_MS
  const rows: Array<{ time: number; row: RecentHostSample }> = []

  for (const sample of samples) {
    if (!sample.sampledAt) continue
    const date = new Date(sample.sampledAt)
    const time = date.getTime()
    if (!Number.isFinite(time) || time < cutoff) continue
    if (host && String(sample.host ?? '') !== host) continue

    rows.push({
      time,
      row: {
        time: sampleTime(date),
        host: sample.host !== null && sample.host !== undefined ? String(sample.host) : null,
        hostLabel: sample.hostLabel ?? 'Unknown host',
        cpuAvg: toNumber(sample.cpuAvg),
        memoryPercent: toNumber(sample.memoryPercent),
        loadAvg: toNumber(sample.loadAvg),
        diskPercent: toNumber(sample.diskPercent),
      },
    })
  }

  rows.sort((a, b) => b.time - a.time)
  return rows.slice(0, Math.max(0, limit)).map(({ row }) => row)
}
