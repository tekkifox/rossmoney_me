import { SAMPLER_INTERVAL_MS } from './hostUsage'
import {
  describeHostSamplerDecision,
  sampleAllEnabledHosts,
  shouldRunHostSampler,
} from './hostSampling'

export type HostSamplerEnv = Record<string, string | undefined>

export type StartHostSamplerOptions = {
  /** Deployment environment to decide from. Defaults to `process.env`. */
  env?: HostSamplerEnv
  /** The sweep to run on every tick. Defaults to `sampleAllEnabledHosts`. */
  sample?: () => void | Promise<void>
  /** Startup log sink; the sampler has no Payload logger before Payload boots. */
  log?: (message: string) => void
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Starts the host sampler's interval for this process.
 *
 * This must be called from `instrumentation.ts#register`, which Next.js runs
 * once when the server starts, before it handles requests. It must not be
 * called from `onInit`: `onInit` first runs wherever Payload is first used,
 * which can be the static render of a route, and a timer created in that async
 * context keeps it forever. Every later tick's `no-store` fetch is then
 * rejected with `DynamicServerError` because Next.js still believes it belongs
 * to that static render.
 *
 * Returns true only when this call created the timer. The guards are unchanged
 * from the old in-`onInit` wiring: production only, and `shouldRunHostSampler`
 * decides which deployment samples.
 */
export function startHostSampler({
  env = process.env,
  sample = sampleAllEnabledHosts,
  log = console.log,
}: StartHostSamplerOptions = {}): boolean {
  log(describeHostSamplerDecision(env))

  if (env.NODE_ENV !== 'production') return false
  if (!shouldRunHostSampler(env)) return false
  if (timer) return false

  const interval = setInterval(() => {
    void sample()
  }, SAMPLER_INTERVAL_MS)
  // A monitoring timer must not keep the process alive on its own.
  interval.unref?.()
  timer = interval
  return true
}

/** Stops a timer started by `startHostSampler` (used by tests and shutdown). */
export function stopHostSampler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
