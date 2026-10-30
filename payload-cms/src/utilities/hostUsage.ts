export type HostUsageRange = '24h' | '7d' | '30d'

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

export const HOST_USAGE_RANGE_MS: Record<HostUsageRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
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

export function bucketKeyFor(date: Date, range: HostUsageRange): string {
  const d = new Date(date)
  if (range === '30d') {
    d.setUTCHours(0, 0, 0, 0)
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
  return `${String(d.getUTCHours()).padStart(2, '0')}:00`
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