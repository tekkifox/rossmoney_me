import { describe, expect, it } from 'vitest'

import { buildHostSampleRecord } from '@/utilities/hostSampling'

const sampledAt = '2026-11-03T10:05:00.000Z'

const fullMetrics = {
  cpuAvg: 12.5,
  memoryUsedBytes: 1048576,
  memoryTotalBytes: 8388608,
  memoryPercent: 12.5,
  loadAvg: 0.75,
  diskPercent: 41.2,
  swapPercent: 3.5,
  processCount: 221,
  hostCount: 1,
  networkRxMB: 10.5,
  networkTxMB: 4.25,
  failedLogins: 7,
  failedLoginUsers: [
    { user: 'root', count: 4 },
    { user: 'admin', count: 3 },
  ],
  updatedAt: '2026-11-03T10:00:00.000Z',
}

/**
 * The scheduled sampler is the only writer of `host-samples` rows, so this
 * pins the record it stores through the shared builder.
 */
describe('host sample record shape', () => {
  it('maps a full telemetry payload', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-1',
      hostLabel: 'host one',
      sampledAt,
      metrics: fullMetrics,
      hosts: [{ cpuCount: 4 }, { cpuCount: 8 }],
    })

    expect(record).toEqual({
      host: 'host-1',
      hostLabel: 'host one',
      sampledAt,
      cpuAvg: 12.5,
      memoryUsedBytes: 1048576,
      memoryTotalBytes: 8388608,
      memoryPercent: 12.5,
      cpuCores: 8,
      loadAvg: 0.75,
      diskPercent: 41.2,
      failedLogins: 7,
      failedLoginUsers: [
        { user: 'root', count: 4 },
        { user: 'admin', count: 3 },
      ],
      swapPercent: 3.5,
      processCount: 221,
      hostCount: 1,
      networkRxMB: 10.5,
      networkTxMB: 4.25,
      updatedAt: '2026-11-03T10:00:00.000Z',
    })
  })

  it('keeps the largest core count when a source aggregates several hosts', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-2',
      hostLabel: 'host two',
      sampledAt,
      metrics: { cpuAvg: 7 },
      hosts: [{ cpuCount: 'nonsense' }, { cpuCount: 16 }, { cpuCount: -4 }, { cpuCount: 8 }],
    })

    expect(record.cpuCores).toBe(16)
  })

  it('stores [] and omits cpuCores when the payload has neither', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-3',
      hostLabel: 'host three',
      sampledAt,
      metrics: { cpuAvg: 9 },
    })

    expect(record.failedLoginUsers).toEqual([])
    expect(record.failedLogins).toBeNull()
    expect(record.cpuCores).toBeUndefined()
    expect(record.updatedAt).toBeNull()
    expect(record.memoryPercent).toBeNull()
  })

  it('drops invalid login counts and user entries individually', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-4',
      hostLabel: 'host four',
      sampledAt,
      metrics: {
        cpuAvg: 2,
        // A fraction is not a login count, so it is dropped rather than
        // rounded; invalid user entries are dropped individually.
        failedLogins: 1.5,
        failedLoginUsers: [
          { user: 'root', count: 2.5 },
          { user: '', count: 1 },
          { user: 42, count: 3 },
          { user: 'admin', count: 0 },
        ],
      },
      hosts: [{ cpuCount: 'nonsense' }],
    })

    expect(record.failedLogins).toBeNull()
    expect(record.failedLoginUsers).toEqual([{ user: 'admin', count: 0 }])
    expect(record.cpuCores).toBeUndefined()
  })

  it('keeps at most 20 failed-login users', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-5',
      hostLabel: 'host five',
      sampledAt,
      metrics: {
        cpuAvg: 1,
        failedLoginUsers: Array.from({ length: 25 }, (_, i) => ({ user: `user-${i}`, count: 25 - i })),
      },
    })

    expect(record.failedLoginUsers).toHaveLength(20)
    expect(record.failedLoginUsers.at(-1)).toEqual({ user: 'user-19', count: 6 })
  })
})
