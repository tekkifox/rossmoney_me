import { describe, expect, it } from 'vitest'

import {
  HOST_USAGE_BUCKET_MS,
  HOST_USAGE_RANGE_MS,
  RECENT_SAMPLE_WINDOW_MS,
  RECENT_SAMPLES_LIMIT,
  SAMPLER_INTERVAL_MS,
  bucketHostSamples,
  bucketKeyFor,
  bucketLabelFor,
  recentHostSamples,
  type HostSample,
} from '@/utilities/hostUsage'

const MINUTE = 60 * 1000

/** 20 samples covering one full hour at the sampler cadence, 12:00–12:57. */
function fullHour(host = 'host-a'): HostSample[] {
  const start = Date.parse('2026-10-30T12:00:00.000Z')
  return Array.from({ length: 20 }, (_, index) => ({
    host,
    sampledAt: new Date(start + index * HOST_USAGE_BUCKET_MS['1h']).toISOString(),
    cpuAvg: 10 + index,
    memoryPercent: 40,
    loadAvg: 0.5,
    diskPercent: 60,
  }))
}

const sample = (sampledAt: string, host = 'host-a'): HostSample => ({
  host,
  sampledAt,
  cpuAvg: 1,
  memoryPercent: 2,
  loadAvg: 3,
  diskPercent: 4,
})

describe('last hour range', () => {
  it('buckets at 3 minutes and yields 20 points for a full hour', () => {
    const now = Date.parse('2026-10-30T13:00:00.000Z')
    const buckets = bucketHostSamples(fullHour(), '1h', now).get('host-a') ?? []

    expect(HOST_USAGE_RANGE_MS['1h']).toBe(60 * MINUTE)
    expect(buckets).toHaveLength(20)
    expect(buckets.every((bucket) => bucket.count === 1)).toBe(true)
    expect(buckets[0].label).toBe('12:00')
    expect(buckets[19].label).toBe('12:57')
    // One sample per bucket: the value is carried through, not averaged.
    expect(buckets.map((bucket) => bucket.cpuAvg)).toEqual(
      Array.from({ length: 20 }, (_, index) => 10 + index),
    )
  })

  it('drops samples older than an hour', () => {
    const now = Date.parse('2026-10-30T13:00:00.000Z')
    const buckets = bucketHostSamples(
      [sample('2026-10-30T11:59:59.999Z'), sample('2026-10-30T12:00:00.000Z')],
      '1h',
      now,
    ).get('host-a')

    expect(buckets).toHaveLength(1)
    expect(buckets?.[0].key).toBe('2026-10-30T12:00:00.000Z')
  })

  it('labels buckets HH:MM in UTC', () => {
    const key = bucketKeyFor(new Date('2026-10-30T09:07:42.000Z'), '1h')

    expect(key).toBe('2026-10-30T09:06:00.000Z')
    expect(bucketLabelFor(key, '1h')).toBe('09:06')
    expect(bucketLabelFor(bucketKeyFor(new Date('2026-10-30T23:57:10.000Z'), '1h'), '1h')).toBe('23:57')
  })

  it('keeps the sampler cadence and the last-hour bucket equal', () => {
    expect(SAMPLER_INTERVAL_MS).toBe(3 * MINUTE)
    expect(HOST_USAGE_BUCKET_MS['1h']).toBe(SAMPLER_INTERVAL_MS)
  })

  it('uses a readable bucket size for every range', () => {
    expect(HOST_USAGE_BUCKET_MS['1h']).toBe(3 * MINUTE)
    expect(HOST_USAGE_BUCKET_MS['24h']).toBe(15 * MINUTE)
    expect(HOST_USAGE_BUCKET_MS['7d']).toBe(60 * MINUTE)
    expect(HOST_USAGE_BUCKET_MS['30d']).toBe(24 * 60 * MINUTE)

    const time = new Date('2026-10-30T12:34:56.000Z')

    expect(bucketKeyFor(time, '1h')).toBe('2026-10-30T12:33:00.000Z')
    expect(bucketKeyFor(time, '24h')).toBe('2026-10-30T12:30:00.000Z')
    expect(bucketKeyFor(time, '7d')).toBe('2026-10-30T12:00:00.000Z')
    expect(bucketKeyFor(time, '30d')).toBe('2026-10-30T00:00:00.000Z')

    expect(bucketLabelFor(bucketKeyFor(time, '1h'), '1h')).toBe('12:33')
    expect(bucketLabelFor(bucketKeyFor(time, '24h'), '24h')).toBe('12:30')
    expect(bucketLabelFor(bucketKeyFor(time, '7d'), '7d')).toBe('12:00')
    expect(bucketLabelFor(bucketKeyFor(time, '30d'), '30d')).toBe('10/30')
  })

  it('yields 96 points across a full 24 hours at 15-minute buckets', () => {
    const now = Date.parse('2026-10-30T12:00:00.000Z')
    const start = now - HOST_USAGE_RANGE_MS['24h']
    const samples = Array.from({ length: 96 }, (_, index) =>
      sample(new Date(start + index * HOST_USAGE_BUCKET_MS['24h']).toISOString()),
    )
    const buckets = bucketHostSamples(samples, '24h', now).get('host-a') ?? []

    expect(buckets).toHaveLength(96)
    expect(buckets[0].label).toBe('12:00')
    expect(buckets[95].label).toBe('11:45')
  })

  it('produces one bucket when the range holds a single sample', () => {
    const now = Date.parse('2026-10-30T12:00:00.000Z')
    const one = [sample('2026-10-30T11:30:00.000Z')]

    for (const range of ['1h', '24h', '7d', '30d'] as const) {
      const buckets = bucketHostSamples(one, range, now).get('host-a') ?? []
      expect(buckets).toHaveLength(1)
      expect(buckets[0].count).toBe(1)
    }
  })
})

describe('recent 15 minute selection', () => {
  const now = Date.parse('2026-10-30T12:00:00.000Z')

  it('excludes samples older than fifteen minutes', () => {
    expect(RECENT_SAMPLE_WINDOW_MS).toBe(15 * MINUTE)
    const rows = recentHostSamples(
      [
        sample('2026-10-30T11:44:59.999Z'),
        sample('2026-10-30T11:45:00.000Z'),
        sample('2026-10-30T11:55:00.000Z'),
      ],
      { now },
    )

    expect(rows.map((row) => row.time)).toEqual(['11:55:00', '11:45:00'])
  })

  it('returns newest first', () => {
    const rows = recentHostSamples(
      [
        sample('2026-10-30T11:50:00.000Z'),
        sample('2026-10-30T11:58:00.000Z'),
        sample('2026-10-30T11:54:00.000Z'),
      ],
      { now },
    )

    expect(rows.map((row) => row.time)).toEqual(['11:58:00', '11:54:00', '11:50:00'])
  })

  it('respects the host filter', () => {
    const rows = recentHostSamples(
      [
        sample('2026-10-30T11:50:00.000Z', 'host-a'),
        sample('2026-10-30T11:51:00.000Z', 'host-b'),
        sample('2026-10-30T11:52:00.000Z', 'host-a'),
      ],
      { now, host: 'host-a' },
    )

    expect(rows.map((row) => row.host)).toEqual(['host-a', 'host-a'])
    expect(rows.map((row) => row.time)).toEqual(['11:52:00', '11:50:00'])
  })

  it('caps the list', () => {
    const samples = Array.from({ length: RECENT_SAMPLES_LIMIT + 10 }, (_, index) =>
      sample(new Date(now - index * 1000).toISOString()),
    )

    expect(recentHostSamples(samples, { now })).toHaveLength(RECENT_SAMPLES_LIMIT)
    expect(recentHostSamples(samples, { now, limit: 3 })).toHaveLength(3)
  })

  it('formats times as HH:MM:SS in UTC', () => {
    const [row] = recentHostSamples([sample('2026-10-30T11:57:05.000Z')], { now })

    expect(row.time).toBe('11:57:05')
  })
})
