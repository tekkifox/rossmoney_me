import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ARCHVIEW_TIMEOUT_MS,
  MAX_ARCHVIEW_TIMEOUT_MS,
  resolveArchviewTimeoutMs,
} from '@/app/api/architecture/route'

describe('archview timeout budget', () => {
  it('defaults to 15000ms when unset', () => {
    expect(resolveArchviewTimeoutMs(undefined)).toBe(15000)
    expect(resolveArchviewTimeoutMs(null)).toBe(15000)
    expect(resolveArchviewTimeoutMs({})).toBe(15000)
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: '' })).toBe(15000)
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: undefined })).toBe(15000)
  })

  it('accepts a valid override', () => {
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: '30000' })).toBe(30000)
    expect(resolveArchviewTimeoutMs('30000')).toBe(30000)
    expect(resolveArchviewTimeoutMs(30000)).toBe(30000)
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: '60000' })).toBe(60000)
  })

  it('falls back to the default for a non-numeric value', () => {
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: 'abc' })).toBe(
      DEFAULT_ARCHVIEW_TIMEOUT_MS,
    )
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: '12abc' })).toBe(
      DEFAULT_ARCHVIEW_TIMEOUT_MS,
    )
  })

  it('falls back to the default for zero', () => {
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: '0' })).toBe(
      DEFAULT_ARCHVIEW_TIMEOUT_MS,
    )
    expect(resolveArchviewTimeoutMs(0)).toBe(DEFAULT_ARCHVIEW_TIMEOUT_MS)
  })

  it('falls back to the default for a negative value', () => {
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: '-1000' })).toBe(
      DEFAULT_ARCHVIEW_TIMEOUT_MS,
    )
    expect(resolveArchviewTimeoutMs(-1000)).toBe(DEFAULT_ARCHVIEW_TIMEOUT_MS)
  })

  it('falls back to the default for a value above the cap', () => {
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: '60001' })).toBe(
      DEFAULT_ARCHVIEW_TIMEOUT_MS,
    )
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: '1000000' })).toBe(
      DEFAULT_ARCHVIEW_TIMEOUT_MS,
    )
    expect(resolveArchviewTimeoutMs(MAX_ARCHVIEW_TIMEOUT_MS + 1)).toBe(
      DEFAULT_ARCHVIEW_TIMEOUT_MS,
    )
  })

  it('never returns an unbounded (non-finite) value', () => {
    expect(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: 'Infinity' })).toBe(
      DEFAULT_ARCHVIEW_TIMEOUT_MS,
    )
    expect(Number.isFinite(resolveArchviewTimeoutMs({ ARCHVIEW_TIMEOUT_MS: 'NaN' }))).toBe(true)
  })
})