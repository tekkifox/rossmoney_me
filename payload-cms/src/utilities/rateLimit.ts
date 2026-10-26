/**
 * Small fixed-window rate limiter for the two endpoints that are worth
 * protecting at the application edge: `/api/users/login` and `/api/og`.
 *
 * This is deliberately not a replacement for an edge/WAF rate limit. It is a
 * cheap, dependency-free guard that works on a single Node process (`next
 * start`, the Portainer container) and gives each serverless isolate a local
 * budget on Vercel. A distributed attacker can still spread requests across
 * isolates; the edge rule remains the stronger control.
 *
 * The store is in memory and intentionally has no persistence: it only needs to
 * survive long enough to blunt a burst, and the process is the unit that is
 * being protected from CPU exhaustion.
 */

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
 * `/api/users/login`: ten attempts per IP per ten minutes.
 *
 * Payload's own account lockout (5 failures / 10 minutes) stays in place. This
 * guard bounds how long one source can keep triggering it; it does not replace
 * the lockout and it is not keyed on the account, so a legitimate admin on a
 * different address is unaffected by someone else's attempts.
 */
export const loginRateLimiter = new FixedWindowRateLimiter(10, 10 * 60 * 1000)

/**
 * `/api/og`: thirty image renders per IP per minute, with a per-process ceiling
 * so rotating source addresses cannot burn all of one isolate's CPU.
 */
export const ogIpRateLimiter = new FixedWindowRateLimiter(30, 60 * 1000)
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
