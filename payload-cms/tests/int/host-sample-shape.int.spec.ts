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
  sshLogins: 5,
  sshLoginUsers: [
    { user: 'deploy', count: 3 },
    { user: 'root', count: 2 },
  ],
  sshLoginsToday: 9,
  sshLoginUsersToday: [
    { user: 'deploy', count: 6 },
    { user: 'root', count: 3 },
  ],
  sshLoginsTodaySince: '2026-11-03T00:00:00Z',
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
      sshLogins: 5,
      sshLoginUsers: [
        { user: 'deploy', count: 3 },
        { user: 'root', count: 2 },
      ],
      sshLoginsToday: 9,
      sshLoginUsersToday: [
        { user: 'deploy', count: 6 },
        { user: 'root', count: 3 },
      ],
      sshLoginsTodaySince: '2026-11-03T00:00:00.000Z',
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

  it('stores accepted logins, today totals and both breakdowns', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-6',
      hostLabel: 'host six',
      sampledAt,
      metrics: {
        sshLogins: 12,
        sshLoginUsers: [
          { user: 'deploy', count: 9 },
          { user: 'root', count: 3 },
        ],
        sshLoginsToday: 40,
        sshLoginUsersToday: [
          { user: 'deploy', count: 30 },
          { user: 'root', count: 10 },
        ],
        sshLoginsTodaySince: '2026-11-03T05:00:00Z',
      },
    })

    expect(record.sshLogins).toBe(12)
    expect(record.sshLoginUsers).toEqual([
      { user: 'deploy', count: 9 },
      { user: 'root', count: 3 },
    ])
    expect(record.sshLoginsToday).toBe(40)
    expect(record.sshLoginUsersToday).toEqual([
      { user: 'deploy', count: 30 },
      { user: 'root', count: 10 },
    ])
    // The timestamp is normalised to one canonical RFC 3339 form.
    expect(record.sshLoginsTodaySince).toBe('2026-11-03T05:00:00.000Z')
  })

  it('stores null totals, [] breakdowns and no window when accepted logins are absent', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-7',
      hostLabel: 'host seven',
      sampledAt,
      metrics: { cpuAvg: 4 },
    })

    expect(record.sshLogins).toBeNull()
    expect(record.sshLoginUsers).toEqual([])
    expect(record.sshLoginsToday).toBeNull()
    expect(record.sshLoginUsersToday).toEqual([])
    expect(record.sshLoginsTodaySince).toBeUndefined()
  })

  it('stores [] when an accepted-login breakdown is not an array', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-8',
      hostLabel: 'host eight',
      sampledAt,
      metrics: { sshLoginUsers: 'root', sshLoginUsersToday: { user: 'root', count: 1 } },
    })

    expect(record.sshLoginUsers).toEqual([])
    expect(record.sshLoginUsersToday).toEqual([])
  })

  it('drops accepted-login entries whose user is not a string', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-9',
      hostLabel: 'host nine',
      sampledAt,
      metrics: {
        sshLoginUsers: [
          { user: 42, count: 3 },
          { user: 'root', count: 1 },
        ],
        sshLoginUsersToday: [
          { user: null, count: 2 },
          { user: 'deploy', count: 2 },
        ],
      },
    })

    expect(record.sshLoginUsers).toEqual([{ user: 'root', count: 1 }])
    expect(record.sshLoginUsersToday).toEqual([{ user: 'deploy', count: 2 }])
  })

  it('drops accepted-login entries with a negative count but keeps zero', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-10',
      hostLabel: 'host ten',
      sampledAt,
      metrics: {
        sshLoginUsers: [
          { user: 'root', count: -1 },
          { user: 'admin', count: 0 },
        ],
        sshLoginUsersToday: [
          { user: 'deploy', count: 2.5 },
          { user: 'admin', count: 0 },
        ],
      },
    })

    expect(record.sshLoginUsers).toEqual([{ user: 'admin', count: 0 }])
    expect(record.sshLoginUsersToday).toEqual([{ user: 'admin', count: 0 }])
  })

  it('drops accepted-login totals that are not whole non-negative numbers', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-11',
      hostLabel: 'host eleven',
      sampledAt,
      metrics: { sshLogins: -2, sshLoginsToday: 2.5 },
    })

    expect(record.sshLogins).toBeNull()
    expect(record.sshLoginsToday).toBeNull()
  })

  it('keeps at most 20 accepted-login users per breakdown', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-12',
      hostLabel: 'host twelve',
      sampledAt,
      metrics: {
        sshLoginUsers: Array.from({ length: 25 }, (_, i) => ({ user: `user-${i}`, count: 25 - i })),
        sshLoginUsersToday: Array.from({ length: 25 }, (_, i) => ({ user: `today-${i}`, count: 25 - i })),
      },
    })

    expect(record.sshLoginUsers).toHaveLength(20)
    expect(record.sshLoginUsers.at(-1)).toEqual({ user: 'user-19', count: 6 })
    expect(record.sshLoginUsersToday).toHaveLength(20)
    expect(record.sshLoginUsersToday.at(-1)).toEqual({ user: 'today-19', count: 6 })
  })

  it('omits the today window when it is not a parseable timestamp', () => {
    const record = buildHostSampleRecord({
      hostId: 'host-13',
      hostLabel: 'host thirteen',
      sampledAt,
      metrics: { sshLoginsToday: 1, sshLoginsTodaySince: 'yesterday-ish' },
    })

    expect(record.sshLoginsToday).toBe(1)
    expect(record.sshLoginsTodaySince).toBeUndefined()
    expect('sshLoginsTodaySince' in record).toBe(false)
  })

  it('omits the today window when it is empty or not a string', () => {
    for (const since of ['', '   ', 1730592000000, null, { at: '2026-11-03' }]) {
      const record = buildHostSampleRecord({
        hostId: 'host-14',
        hostLabel: 'host fourteen',
        sampledAt,
        metrics: { sshLoginsTodaySince: since },
      })

      expect('sshLoginsTodaySince' in record).toBe(false)
    }
  })
})
