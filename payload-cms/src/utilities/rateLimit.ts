/**
 * Small fixed-window rate limiters for the two endpoints that are worth
 * protecting at the application edge: `/api/users/login` and `/api/og`.
 *
 * This is deliberately not a replacement for an edge/WAF rate limit. It is a
 * cheap guard in front of expensive handlers. The per-IP budgets are stored in
 * MongoDB so all instances share one counter; the in-memory limiter remains as
 * the failure mode (an unreachable database must not make the admin
 * unloggable) and as the store for the deliberately per-process OG CPU ceiling.
 */

import { getSharedRateLimitStore, type RateLimitStore } from './rateLimitStore'

export type RateLimitResult = {
  allowed: boolean
  /** Seconds until the window resets, or 0 when allowed. */
  retryAfter: number
  /** Requests left in the current window. */
  remaining: number
}

type Bucket = {
  count: number
  resetAt: number
}

/**
 * Buckets are kept per limiter. A limiter with a very large key space (per-IP)
 * prunes expired entries lazily so a long-running process does not accumulate
 * one object per address forever.
 */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {
    if (limit < 1) {
      throw new Error('rate limit must be at least 1')
    }
    if (windowMs < 1) {
      throw new Error('rate limit window must be at least 1ms')
    }
  }

  take(key: string, now: number = Date.now()): RateLimitResult {
    let bucket = this.buckets.get(key)

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs }
      this.buckets.set(key, bucket)
      this.prune(now)
    }

    bucket.count += 1

    if (bucket.count > this.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      return { allowed: false, retryAfter, remaining: 0 }
    }

    return {
      allowed: true,
      retryAfter: 0,
      remaining: Math.max(0, this.limit - bucket.count),
    }
  }

  reset(): void {
    this.buckets.clear()
  }

  get size(): number {
    return this.buckets.size
  }

  private prune(now: number): void {
    if (this.buckets.size <= this.maxKeys) {
      return
    }

    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key)
      }
    }

    // Expired buckets are the common case. If a burst still left the map over
    // its bound, evict oldest-inserted buckets so the limiter itself cannot be
    // turned into a memory-exhaustion target by rotating spoofed addresses.
    if (this.buckets.size <= this.maxKeys) {
      return
    }

    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= this.maxKeys) {
        break
      }
      this.buckets.delete(key)
    }
  }
}

/**
 * A limiter whose budget lives in a store every instance can reach.
 *
 * The store call is raced against `storeTimeoutMs`. If it times out, is
 * unreachable or returns an error, the request falls back to this process's
 * in-memory limiter: no 500 and no free pass. A database outage therefore
 * degrades to the pre-existing per-instance behaviour rather than locking the
 * admin out or removing the guard.
 */
export class SharedFixedWindowRateLimiter {
  private readonly fallback: FixedWindowRateLimiter

  constructor(
    private readonly name: string,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly store: RateLimitStore | null = getSharedRateLimitStore(),
    private readonly storeTimeoutMs = 500,
  ) {
    this.fallback = new FixedWindowRateLimiter(limit, windowMs)
  }

  async take(key: string, now: number = Date.now()): Promise<RateLimitResult> {
    if (!this.store) {
      return this.fallback.take(key, now)
    }

    try {
      const { count, resetAt } = await withDeadline(
        this.store.increment(`${this.name}:${key}`, this.windowMs),
        this.storeTimeoutMs,
      )

      if (count > this.limit) {
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
          remaining: 0,
        }
      }

      return {
        allowed: true,
        retryAfter: 0,
        remaining: Math.max(0, this.limit - count),
      }
    } catch {
      warnStoreFallback(this.name)
      return this.fallback.take(key, now)
    }
  }
}

/** Reject if `promise` has not settled within `ms`; never leaves a timer behind. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rate limit store deadline')), ms)
    timer.unref?.()

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

let lastStoreWarningAt = 0

/**
 * One line per minute at most: a database outage affects every request, and a
 * log line per request would make the incident harder to read. The message
 * deliberately carries no URI or topology detail.
 */
function warnStoreFallback(name: string): void {
  const now = Date.now()
  if (now - lastStoreWarningAt < 60_000) {
    return
  }
  lastStoreWarningAt = now
  console.warn(`[rate-limit] shared store unavailable for ${name}; using in-memory fallback`)
}

/**
 * `/api/users/login`: ten attempts per IP per ten minutes, shared by every
 * instance.
 *
 * Payload's own account lockout (5 failures / 10 minutes) stays in place. This
 * guard bounds how long one source can keep triggering it; it does not replace
 * the lockout and it is not keyed on the account, so a legitimate admin on a
 * different address is unaffected by someone else's attempts.
 */
export const loginRateLimiter = new SharedFixedWindowRateLimiter(
  'login',
  10,
  10 * 60 * 1000,
)

/**
 * `/api/og`: thirty image renders per IP per minute, shared by every instance.
 */
export const ogIpRateLimiter = new SharedFixedWindowRateLimiter('og', 30, 60 * 1000)

/**
 * `/api/og`: three hundred renders per minute **per process**, deliberately
 * not shared. It is a CPU ceiling for one instance, so it should not be raised
 * or lowered by how many instances happen to be warm.
 */
export const ogGlobalRateLimiter = new FixedWindowRateLimiter(300, 60 * 1000)

/** Client address, using the headers the Vercel and openresty edges set. */
export const clientAddress = (headers: Headers): string => {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) {
      return first
    }
  }

  return headers.get('x-real-ip')?.trim() || 'unknown'
}
