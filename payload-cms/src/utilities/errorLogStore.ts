import type { Payload } from 'payload'
import { getPayload } from 'payload'
import config from '@payload-config'

import {
  ERROR_LOG_LIMITS,
  normaliseErrorReport,
  scrubErrorText,
  type ErrorReportInput,
  type NormalisedErrorReport,
} from './errorLog'

const COLLECTION = 'error-logs'

export type RecordErrorResult = {
  stored: boolean
  reason?: 'invalid' | 'timed-out' | 'store-failed'
}

export type RecordErrorOptions = {
  /** Test seam. Production calls use the cached Payload instance. */
  payload?: Payload
  now?: Date
  maxRows?: number
  dedupWindowMs?: number
  timeoutMs?: number
}

type StoredErrorLog = {
  id: string | number
  occurrences?: number | null
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`error log write exceeded ${timeoutMs}ms`)),
      Math.max(1, timeoutMs),
    )
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

const rowData = (report: NormalisedErrorReport) => ({
  level: report.level,
  message: report.message,
  stack: report.stack,
  route: report.route,
  url: report.url,
  source: report.source,
  environment: report.environment,
  release: report.release,
  userAgent: report.userAgent,
  fingerprint: report.fingerprint,
  occurrences: 1,
  timestamp: report.timestamp.toISOString(),
  lastSeen: report.timestamp.toISOString(),
})

/**
 * Bound the collection. Deletes the oldest rows only, in small batches, and
 * never lets a retention problem fail the write that has already happened.
 * Exported for the retention test so it can be exercised without deleting rows
 * from a database the developer may have pointed the suite at.
 */
export const pruneOldestRows = async (
  payload: Payload,
  maxRows: number,
): Promise<void> => {
  let excess = (await payload.count({ collection: COLLECTION, overrideAccess: true })).totalDocs - maxRows

  for (let attempt = 0; excess > 0 && attempt < 5; attempt += 1) {
    const batchSize = Math.min(excess, 250)
    const oldest = await payload.find({
      collection: COLLECTION,
      sort: 'lastSeen',
      limit: batchSize,
      depth: 0,
      overrideAccess: true,
    })

    const ids = oldest.docs.map((doc) => doc.id)
    if (ids.length === 0) {
      return
    }

    await payload.delete({
      collection: COLLECTION,
      where: { id: { in: ids } },
      overrideAccess: true,
    })

    excess =
      (await payload.count({ collection: COLLECTION, overrideAccess: true })).totalDocs - maxRows
  }
}

const persist = async (
  payload: Payload,
  report: NormalisedErrorReport,
  options: RecordErrorOptions,
): Promise<void> => {
  const dedupWindowMs = options.dedupWindowMs ?? ERROR_LOG_LIMITS.dedupWindowMs
  const maxRows = options.maxRows ?? ERROR_LOG_LIMITS.maxRows
  const since = new Date(report.timestamp.getTime() - dedupWindowMs).toISOString()

  const existing = await payload.find({
    collection: COLLECTION,
    where: {
      and: [
        { fingerprint: { equals: report.fingerprint } },
        { lastSeen: { greater_than_equal: since } },
      ],
    },
    sort: '-lastSeen',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const match = existing.docs[0] as StoredErrorLog | undefined

  if (match) {
    // Keep the first timestamp; refresh the detail so the newest stack is the
    // one an admin reads, and count the repeat instead of adding a row.
    await payload.update({
      collection: COLLECTION,
      id: match.id,
      data: {
        message: report.message,
        stack: report.stack,
        level: report.level,
        userAgent: report.userAgent,
        environment: report.environment,
        release: report.release,
        occurrences: (typeof match.occurrences === 'number' ? match.occurrences : 1) + 1,
        lastSeen: report.timestamp.toISOString(),
      },
      overrideAccess: true,
    })
  } else {
    await payload.create({
      collection: COLLECTION,
      data: rowData(report),
      overrideAccess: true,
    })
  }

  try {
    await pruneOldestRows(payload, maxRows)
  } catch (retentionError) {
    console.error(
      '[error-reporting] retention sweep failed:',
      scrubErrorText(
        retentionError instanceof Error ? retentionError.message : String(retentionError),
        500,
      ),
    )
  }
}

/**
 * Record an error. This function never throws and never waits indefinitely: a
 * broken database must not take the site down or stall a request. Failures are
 * written to stderr so the container log still shows them.
 */
export async function recordError(
  input: ErrorReportInput | unknown,
  options: RecordErrorOptions = {},
): Promise<RecordErrorResult> {
  const now = options.now ?? new Date()
  const timeoutMs = options.timeoutMs ?? 3_000

  try {
    const report = normaliseErrorReport(input, now)
    if (!report) {
      return { stored: false, reason: 'invalid' }
    }

    const payload =
      options.payload ?? (await withTimeout(getPayload({ config: await config }), timeoutMs))

    await withTimeout(persist(payload, report, options), timeoutMs)
    return { stored: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = message.startsWith('error log write exceeded')

    // Scrub the stderr copy too: a driver error can contain the database URL.
    console.error(`[error-reporting] could not store error: ${scrubErrorText(message, 500)}`)
    return { stored: false, reason: timedOut ? 'timed-out' : 'store-failed' }
  }
}
