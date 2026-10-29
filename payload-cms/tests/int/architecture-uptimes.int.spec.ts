import { describe, expect, it } from 'vitest'

import { stripUptimesForRawDump } from '@/utilities/architectureUptimes'

describe('stripUptimesForRawDump', () => {
  it('removes status and uptime-only fields from containers but keeps the rest', () => {
    const payload = {
      project: 'rossmoney_me',
      containers: [
        {
          name: 'payload-cms',
          image: 'ghcr.io/tekkifox/rossmoney:latest',
          status: 'Up 3 hours',
          state: 'running',
          startedAt: '2026-10-29T09:00:00Z',
          uptime: 10800,
          ports: ['3000/tcp'],
        },
      ],
    }

    expect(stripUptimesForRawDump(payload)).toEqual({
      project: 'rossmoney_me',
      containers: [
        {
          name: 'payload-cms',
          image: 'ghcr.io/tekkifox/rossmoney:latest',
          state: 'running',
          ports: ['3000/tcp'],
        },
      ],
    })
  })

  it('handles nested container arrays and case variants', () => {
    const payload = {
      docker: {
        Containers: [
          {
            Name: 'mongo',
            Image: 'mongo:7',
            Status: 'Up 2 days',
            State: { Status: 'running', StartedAt: '2026-10-27T09:00:00Z' },
            Labels: { uptime: 'not a timestamp' },
          },
        ],
      },
    }

    expect(stripUptimesForRawDump(payload)).toEqual({
      docker: {
        Containers: [
          {
            Name: 'mongo',
            Image: 'mongo:7',
            State: { Status: 'running' },
            Labels: { uptime: 'not a timestamp' },
          },
        ],
      },
    })
  })

  it('does not remove status outside container objects', () => {
    const payload = {
      status: 'ok',
      containers: [{ name: 'cms', status: 'Up 1 minute', state: 'running' }],
    }

    expect(stripUptimesForRawDump(payload)).toEqual({
      status: 'ok',
      containers: [{ name: 'cms', state: 'running' }],
    })
  })

  it('leaves the original payload untouched', () => {
    const payload = {
      containers: [{ name: 'cms', status: 'Up 3 hours', startedAt: '2026-10-29T09:00:00Z' }],
    }

    stripUptimesForRawDump(payload)

    expect(payload.containers[0]).toEqual({
      name: 'cms',
      status: 'Up 3 hours',
      startedAt: '2026-10-29T09:00:00Z',
    })
  })

  it('keeps every field when there are no containers', () => {
    const payload = { project: 'rossmoney_me', telemetry: { metrics: { cpuAvg: 12.5 } } }

    expect(stripUptimesForRawDump(payload)).toEqual(payload)
  })

  it('handles absent and empty input', () => {
    expect(stripUptimesForRawDump({})).toEqual({})
    expect(stripUptimesForRawDump({ containers: [] })).toEqual({ containers: [] })
    expect(stripUptimesForRawDump(null)).toBeNull()
    expect(stripUptimesForRawDump(undefined)).toBeUndefined()
  })
})
