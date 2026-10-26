import { MongoClient } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MongoRateLimitStore, RATE_LIMIT_COLLECTION } from '@/utilities/rateLimitStore'

// `vitest.setup-db.ts` points MONGODB_URI at the disposable MongoDB started by
// the global setup (or at the database a developer/CI supplied).
const uri = process.env.MONGODB_URI || process.env.DATABASE_URL

const uniqueKey = () =>
  `spec:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`

describe.skipIf(!uri)('MongoRateLimitStore', () => {
  let first: MongoRateLimitStore
  let second: MongoRateLimitStore
  let admin: MongoClient

  beforeAll(async () => {
    first = new MongoRateLimitStore(uri!)
    second = new MongoRateLimitStore(uri!)
    admin = new MongoClient(uri!)
    await admin.connect()
  })

  afterAll(async () => {
    await Promise.all([first.close(), second.close(), admin.close()])
  })

  it('makes two independent clients exhaust one budget', async () => {
    const key = uniqueKey()

    const counts: number[] = []
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const store = attempt % 2 === 0 ? first : second
      const state = await store.increment(key, 60_000)
      counts.push(state.count)
    }

    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('increments atomically under concurrent writers', async () => {
    const key = uniqueKey()

    const states = await Promise.all(
      Array.from({ length: 20 }, (_, attempt) =>
        (attempt % 2 === 0 ? first : second).increment(key, 60_000),
      ),
    )

    expect(states.map((state) => state.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
  })

  it('starts a fresh window after the previous one expires', async () => {
    const key = uniqueKey()

    const before = await first.increment(key, 60)
    expect(before.count).toBe(1)

    await new Promise((resolve) => setTimeout(resolve, 120))

    const after = await second.increment(key, 60)
    expect(after.count).toBe(1)
    expect(after.resetAt).toBeGreaterThan(before.resetAt)
  })

  it('expires buckets with a TTL index aligned to the window', async () => {
    await first.increment(uniqueKey(), 60_000)

    const indexes = await admin.db().collection(RATE_LIMIT_COLLECTION).indexes()

    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { resetAt: 1 },
        expireAfterSeconds: 0,
      }),
    )
  })
})
