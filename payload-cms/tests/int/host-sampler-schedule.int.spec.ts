import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SAMPLER_INTERVAL_MS } from '@/utilities/hostUsage'
import { startHostSampler, stopHostSampler } from '@/utilities/hostSamplerSchedule'

const productionEnv = (overrides: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'production',
  ...overrides,
})

describe('host sampler schedule', () => {
  beforeEach(() => stopHostSampler())
  afterEach(() => stopHostSampler())

  it('creates one unref’d interval at the shared cadence and ticks the sweep', () => {
    const sample = vi.fn<() => void>()
    const log = vi.fn<(message: string) => void>()
    const unref = vi.fn<() => void>()
    let tick: (() => void) | undefined
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(((fn: () => void) => {
        tick = fn
        return { unref } as unknown as ReturnType<typeof setInterval>
      }) as unknown as typeof setInterval)

    expect(startHostSampler({ env: productionEnv(), sample, log })).toBe(true)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), SAMPLER_INTERVAL_MS)
    expect(unref).toHaveBeenCalledTimes(1)
    expect(sample).not.toHaveBeenCalled()

    tick?.()
    expect(sample).toHaveBeenCalledTimes(1)

    // Next.js calls `register` once, but a second call must not add a timer.
    expect(startHostSampler({ env: productionEnv(), sample, log })).toBe(false)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)

    setIntervalSpy.mockRestore()
  })

  it('does not create a timer outside production', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    expect(
      startHostSampler({
        env: { NODE_ENV: 'test' },
        sample: vi.fn<() => void>(),
        log: vi.fn<(message: string) => void>(),
      }),
    ).toBe(false)
    expect(setIntervalSpy).not.toHaveBeenCalled()

    setIntervalSpy.mockRestore()
  })

  it('honours the deployment-owner guard', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const env = productionEnv({
      HOST_SAMPLER_OWNER: 'portainer',
      HOST_SAMPLER_INSTANCE: 'vercel',
    })

    expect(
      startHostSampler({
        env,
        sample: vi.fn<() => void>(),
        log: vi.fn<(message: string) => void>(),
      }),
    ).toBe(false)
    expect(setIntervalSpy).not.toHaveBeenCalled()

    expect(
      startHostSampler({
        env: productionEnv({ HOST_SAMPLER_OWNER: 'portainer', HOST_SAMPLER_INSTANCE: 'portainer' }),
        sample: vi.fn<() => void>(),
        log: vi.fn<(message: string) => void>(),
      }),
    ).toBe(true)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)

    setIntervalSpy.mockRestore()
  })

  /**
   * The regression was the timer being created in Payload's `onInit`, which can
   * first run inside a route's static render and lend that context to every
   * tick. The sampler belongs to the instrumentation hook now; this pins that
   * the config no longer schedules anything itself.
   */
  it('is not scheduled from the Payload onInit hook', () => {
    const configSource = readFileSync(resolve(process.cwd(), 'src/payload.config.ts'), 'utf8')

    expect(configSource).not.toMatch(/setInterval/)
    expect(configSource).not.toContain('sampleAllEnabledHosts')
  })
})
