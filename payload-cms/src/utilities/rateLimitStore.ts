/**
 * Shared fixed-window counters.
 *
 * Next 16 compiles `src/proxy.ts` as a Node.js middleware, so the proxy can use
 * the MongoDB deployment the app already has instead of keeping a budget per
 * serverless instance. One document per bucket, one atomic pipeline update per
 * request; a failing or slow store is the caller's problem to fall back from
 * (see `rateLimit.ts`).
 */

import { MongoClient, type Collection } from 'mongodb'

export const RATE_LIMIT_COLLECTION = 'rate_limit_windows'

/** One document per limiter + key (IP address, or `global`). */
export type RateLimitDocument = {
  _id: string
  count: number
  resetAt: Date
}

export type RateLimitStore = {
  /**
   * Increment the bucket for `key` and return its state. The window starts on
   * the first increment after the previous window expired, and is not extended
   * by later increments. Implementations must be atomic across processes.
   */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>
}

/**
 * MongoDB-backed counter. The client is created once per process (the class is
 * normally reached through `getSharedRateLimitStore`) and connected lazily, so
 * importing this module never opens a socket and the build does not need a
 * database.
 */
export class MongoRateLimitStore implements RateLimitStore {
  private readonly client: MongoClient
  private connectPromise: Promise<void> | null = null
  private indexPromise: Promise<void> | null = null

  constructor(uri: string) {
    this.client = new MongoClient(uri, {
      appName: 'rossmoney-rate-limit',
      // A handful of concurrent proxy requests is all this pool needs. Keeping
      // it small matters on serverless plans with a connection cap.
      maxPoolSize: 2,
      minPoolSize: 0,
      connectTimeoutMS: 1_500,
      serverSelectionTimeoutMS: 1_500,
      socketTimeoutMS: 2_000,
    })
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const collection = await this.collection()

    // A pipeline update makes "start a new window" and "increment the current
    // one" one atomic operation. `$$NOW` is the server clock, so instances with
    // skewed clocks still agree on when a window ends. On upsert MongoDB builds
    // the base document from the `_id` equality in the filter, and the missing
    // `resetAt` compares false, giving count 1 and a fresh window.
    const document = await collection.findOneAndUpdate(
      { _id: key },
      [
        {
          $set: {
            count: {
              $cond: [{ $gt: ['$resetAt', '$$NOW'] }, { $add: ['$count', 1] }, 1],
            },
            resetAt: {
              $cond: [
                { $gt: ['$resetAt', '$$NOW'] },
                '$resetAt',
                { $add: ['$$NOW', windowMs] },
              ],
            },
          },
        },
      ],
      {
        upsert: true,
        returnDocument: 'after',
        // Bound the server-side work as well; the caller also races the whole
        // operation against a short deadline.
        maxTimeMS: 400,
      },
    )

    if (!document) {
      throw new Error('rate limit counter update returned no document')
    }

    return { count: document.count, resetAt: document.resetAt.getTime() }
  }

  async close(): Promise<void> {
    await this.client.close()
  }

  private async collection(): Promise<Collection<RateLimitDocument>> {
    // `connect()` is idempotent, but caching the promise keeps the first burst
    // of proxy requests from racing several handshakes.
    this.connectPromise ??= this.client
      .connect()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.connectPromise = null
        throw error
      })
    await this.connectPromise

    const collection = this.client
      .db()
      .collection<RateLimitDocument>(RATE_LIMIT_COLLECTION)

    // TTL expiry is housekeeping, not correctness: the update above resets an
    // expired document whether or not the TTL monitor has removed it yet. If
    // index creation is not permitted, limiting still works but documents
    // linger, so retry on the next request instead of caching the failure.
    this.indexPromise ??= collection
      .createIndex({ resetAt: 1 }, { expireAfterSeconds: 0, name: 'resetAt_ttl' })
      .then(() => undefined)
      .catch((error: unknown) => {
        this.indexPromise = null
        throw error
      })
    await this.indexPromise

    return collection
  }
}

type RateLimitGlobal = typeof globalThis & {
  __rossmoneyRateLimitStore?: MongoRateLimitStore
}

/**
 * The URI Payload itself would use. The store is only created when a URI is
 * configured: an unconfigured instance (`pnpm dev` with no `.env`, a build,
 * tests that do not touch the database) stays on the in-memory limiter rather
 * than paying a connection timeout on every login.
 */
const configuredUri = (): string | null =>
  process.env.MONGODB_URI || process.env.DATABASE_URL || null

/**
 * Process-wide store, cached on `globalThis` so `next dev` hot reloads do not
 * leak a MongoClient per recompile.
 */
export const getSharedRateLimitStore = (): RateLimitStore | null => {
  const uri = configuredUri()
  if (!uri) {
    return null
  }

  const scope = globalThis as RateLimitGlobal
  scope.__rossmoneyRateLimitStore ??= new MongoRateLimitStore(uri)
  return scope.__rossmoneyRateLimitStore
}
