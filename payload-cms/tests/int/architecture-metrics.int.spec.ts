import { describe, expect, it } from 'vitest'

import { architectureMetricsFromPayload } from '@/utilities/architectureMetrics'

describe('architectureMetricsFromPayload', () => {
  it('formats the telemetry the metric cards display', () => {
    const values = architectureMetricsFromPayload({
      telemetry: {
        metrics: {
          cpuAvg: 37,
          memoryUsedBytes: 3 * 1024 ** 3,
          memoryTotalBytes: 8 * 1024 ** 3,
          memoryPercent: 37.5,
          loadAvg: '0.42',
          diskUsedBytes: 40 * 1024 ** 3,
          diskTotalBytes: 100 * 1024 ** 3,
          diskPercent: 40,
          swapTotalBytes: 2 * 1024 ** 3,
          swapFreeBytes: 1.5 * 1024 ** 3,
          networkRxMB: 12.34,
          networkTxMB: 5.67,
          hostCount: 3,
          processCount: 128,
          topOS: 'Debian 12',
        },
      },
    })

    expect(values).toEqual({
      cpu: '37%',
      memory: '3.00 GB / 8.00 GB (37.5%)',
      load: '0.42',
      disk: '40.00 GB / 100.00 GB (40%)',
      swap: '0.50 GB / 2.00 GB',
      network: '12.3 MB rx / 5.7 MB tx',
      hosts: '3',
      processes: '128',
      os: 'Debian 12',
    })
  })

  it('keeps the degraded placeholders when no telemetry was returned', () => {
    expect(architectureMetricsFromPayload(null)).toEqual({
      cpu: 'N/A',
      memory: 'N/A',
      load: 'N/A',
      disk: 'N/A',
      swap: 'N/A',
      network: 'N/A',
      hosts: '0',
      processes: 'N/A',
      os: 'N/A',
    })
  })
})
