/**
 * Proves that two independent Node processes share one rate-limit budget.
 *
 *   corepack pnpm@12.15.0 verify:rate-limit
 *
 * The parent creates a throwaway database on the configured MongoDB server and
 * then runs this file twice as a child process, so each run has its own module
 * graph, MongoClient and in-memory limiter — the same situation as two warm
 * Vercel instances. The first child consumes six of the ten login attempts, the
 * second one must see attempts 7..10 allowed and 11..12 refused. The database
 * is dropped at the end; the database named in the configured URI is never used.
 *
 * Development-only; nothing here is imported by the app or the build.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { MongoClient } from 'mongodb'

import { SharedFixedWindowRateLimiter } from '../src/utilities/rateLimit'
import { MongoRateLimitStore, RATE_LIMIT_COLLECTION } from '../src/utilities/rateLimitStore'
import {
  createScratchDatabase,
  dropScratchDatabase,
  resolveBaseMongoUri,
} from './scratch-db'

const LIMIT = 10
const WINDOW_MS = 10 * 60 * 1000
const KEY = '203.0.113.7'

const script = fileURLToPath(import.meta.url)

if (process.env.RATE_LIMIT_PROOF_CHILD === '1') {
  const label = process.env.RATE_LIMIT_PROOF_LABEL ?? 'instance'
  const uri = process.env.MONGODB_URI

  if (!uri) {
    throw new Error('RATE_LIMIT_PROOF_CHILD needs MONGODB_URI')
  }

  const store = new MongoRateLimitStore(uri)
  const limiter = new SharedFixedWindowRateLimiter('proof', LIMIT, WINDOW_MS, store, 500)

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const result = await limiter.take(KEY)
    console.log(
      `${label} attempt ${String(attempt).padStart(2)}: allowed=${result.allowed} remaining=${result.remaining} retryAfter=${result.retryAfter}`,
    )
  }

  await store.close()
} else {
  const scratch = createScratchDatabase(resolveBaseMongoUri(), 'rossmoney_rate_limit')
  const uri = scratch.uri
  const admin = new MongoClient(uri)

  const runChild = (label: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import=tsx/esm', script], {
        env: { ...process.env, MONGODB_URI: uri, RATE_LIMIT_PROOF_CHILD: '1', RATE_LIMIT_PROOF_LABEL: label },
        stdio: 'inherit',
      })

      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`${label} exited with ${code}`))
        }
      })
    })

  try {
    console.log(`throwaway database: ${scratch.databaseName}`)
    console.log('one budget: 10 attempts per key, window 10m')
    await runChild('process A')
    await runChild('process B')

    await admin.connect()
    const document = await admin
      .db(scratch.databaseName)
      .collection(RATE_LIMIT_COLLECTION)
      .findOne({ _id: `proof:${KEY}` })
    const indexes = await admin.db(scratch.databaseName).collection(RATE_LIMIT_COLLECTION).indexes()

    console.log('shared counter:', JSON.stringify(document))
    console.log(
      'ttl index:',
      JSON.stringify(indexes.find((index) => index.name === 'resetAt_ttl')),
    )
    console.log('expected shared count: 12 (6 from each process)')
  } finally {
    await admin.close()
    await dropScratchDatabase(scratch)
    console.log(`dropped throwaway database: ${scratch.databaseName}`)
  }
}
