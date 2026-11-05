import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { startHostSampler } = vi.hoisted(() => ({ startHostSampler: vi.fn<() => void>() }))

vi.mock('@/utilities/hostSamplerSchedule', () => ({ startHostSampler }))

import { register } from '@/instrumentation'

describe('instrumentation register', () => {
  beforeEach(() => {
    startHostSampler.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('starts the host sampler from the server startup hook', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')

    await register()

    expect(startHostSampler).toHaveBeenCalledTimes(1)
    expect(startHostSampler).toHaveBeenCalledWith()
  })

  it('leaves the edge runtime alone', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')

    await register()

    expect(startHostSampler).not.toHaveBeenCalled()
  })
})
