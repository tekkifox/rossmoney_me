import type { Payload } from 'payload'

import { asString } from './json'

/**
 * Last-known-good ArchView snapshots, one row per source/project.
 *
 * The page render and the `/api/architecture` proxy both fetch the same JSON
 * from ArchView. When that fetch succeeds the redacted body is written here, so
 * a later outage (or a development machine with no ArchView and no
 * `ARCHVIEW_SECRET_KEY`) can still render the last snapshot. The row is
 * replaced in place rather than appended: the collection never grows, and a
 * failed fetch never touches it.
 */

/** Do not rewrite the row more often than this while a page is being viewed. */
export const SNAPSHOT_WRITE_THROTTLE_MS = 60_000

/** Within this age a cache-served response is marked `hit`, older is `stale`. */
export const SNAPSHOT_FRESH_MS = 45_000

export const DEFAULT_SNAPSHOT_MAX_AGE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

type SnapshotEnv = {
  ARCHVIEW_SNAPSHOT_MAX_AGE_DAYS?: string
  [key: string]: string | undefined
}

export type SnapshotCacheIdentity = {
  /** `archview-sources.id` when the source is a collection row. */
  sourceId?: string | null
  /** Resolved origin, used when there is no source row. */
  origin?: string | null
  /** Project query value; empty when the request names none. */
  project?: string | null
}

export type CachedSnapshotLookup = {
  key: string
  snapshot: Record<string, unknown>
  fetchedAt: number
  ageMs: number
  /** True when the row is usable but older than `SNAPSHOT_FRESH_MS`. */
  stale: boolean
  documentId: string
  sourceId?: string
  sourceName?: string
  origin?: string
  project?: string
  byteSize?: number
}

export type ReadCachedSnapshotOptions = {
  now?: number
  freshnessMs?: number
  maxAgeMs?: number
  env?: SnapshotEnv
}

export type WriteCachedSnapshotOptions = {
  now?: number
  throttleMs?: number
  sourceName?: string
  byteSize?: number
}

export type WriteCachedSnapshotResult = {
  written: boolean
  reason?: 'no-payload' | 'throttled' | 'unchanged' | 'invalid' | 'error'
}

/**
 * Canonical origin for cache keys: lower-case scheme/host, no trailing slash,
 * no path/query. A value that is not an absolute URL is kept (trimmed, without
 * a trailing slash) so a bootstrap value still keys consistently on both paths.
 */
export const normalizeSnapshotOrigin = (value?: string | null): string => {
  const candidate = asString(value)?.trim() ?? ''
  if (!candidate) {
    return ''
  }

  try {
    return new URL(candidate).origin
  } catch {
    return candidate.replace(/\/$/, '')
  }
}

/**
 * The one key used by both the page render and the proxy. The source id wins
 * over the origin so two rows on the same origin cannot share a snapshot; the
 * project is always present (as an empty segment) so `/api/architecture` and
 * `/api/architecture?project=x` never collide.
 */
export const cacheKeyFor = (identity: SnapshotCacheIdentity): string => {
  const sourceId = asString(identity.sourceId)?.trim() ?? ''
  const origin = normalizeSnapshotOrigin(identity.origin)
  const reference = sourceId ? `id:${sourceId}` : `origin:${origin}`
  const project = asString(identity.project)?.trim() ?? ''
  return `${reference}|${project}`
}

const maxAgeFromEnv = (env: SnapshotEnv): number => {
  const days = Number(asString(env.ARCHVIEW_SNAPSHOT_MAX_AGE_DAYS)?.trim() ?? '')
  if (Number.isFinite(days) && days > 0) {
    return days * DAY_MS
  }
  return DEFAULT_SNAPSHOT_MAX_AGE_DAYS * DAY_MS
}

const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

/** Payload returns a date field as an ISO string; accept a date or epoch too. */
const timestamp = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const stringOrUndefined = (value: unknown): string | undefined => {
  const candidate = asString(value)?.trim() ?? ''
  return candidate ? candidate : undefined
}

const snapshotOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/**
 * JSON with object keys sorted, so a byte-for-byte difference in Mongo's key
 * order does not make an unchanged snapshot look new.
 */
const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      result[key] = stableValue(record[key])
    }
    return result
  }
  return value
}

const stableStringify = (value: unknown): string => JSON.stringify(stableValue(value))

/**
 * The newest usable row for `key`, or `null` when there is no database, no row,
 * or the row is older than the configured ceiling. The caller decides whether
 * to label it `hit` or `stale`; a stale row is still served.
 */
export async function readCachedSnapshot(
  payload: Payload | null | undefined,
  key: string,
  options: ReadCachedSnapshotOptions = {},
): Promise<CachedSnapshotLookup | null> {
  if (!payload || !key) {
    return null
  }

  const now = options.now ?? Date.now()
  const freshnessMs = options.freshnessMs ?? SNAPSHOT_FRESH_MS
  const maxAgeMs = options.maxAgeMs ?? maxAgeFromEnv(options.env ?? process.env)

  try {
    const result = await payload.find({
      collection: 'archview-snapshots',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      sort: '-fetchedAt',
      where: { key: { equals: key } },
    })
    const doc = result.docs[0] as unknown as Record<string, unknown> | undefined
    if (!doc) {
      return null
    }

    const fetchedAt = timestamp(doc.fetchedAt)
    const snapshot = snapshotOf(doc.snapshot)
    if (fetchedAt === null || !snapshot) {
      return null
    }

    const ageMs = Math.max(0, now - fetchedAt)
    if (ageMs > maxAgeMs) {
      return null
    }

    return {
      key,
      snapshot,
      fetchedAt,
      ageMs,
      stale: ageMs > freshnessMs,
      documentId: String(doc.id),
      sourceId: stringOrUndefined(doc.sourceId),
      sourceName: stringOrUndefined(doc.sourceName),
      origin: stringOrUndefined(doc.origin),
      project: stringOrUndefined(doc.project),
      byteSize: numeric(doc.byteSize) ?? undefined,
    }
  } catch (error) {
    console.warn(
      'ArchView snapshot cache read failed:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/**
 * Replace the row for `identity` in place. Only a successful live fetch may
 * call this: a failure must never overwrite a good row. The write is skipped
 * when the existing row is newer than `throttleMs`, or when the redacted body
 * is identical to the stored one (so a busy page does not rewrite bytes).
 */
export async function writeCachedSnapshot(
  payload: Payload | null | undefined,
  identity: SnapshotCacheIdentity,
  snapshot: Record<string, unknown>,
  options: WriteCachedSnapshotOptions = {},
): Promise<WriteCachedSnapshotResult> {
  if (!payload) {
    return { written: false, reason: 'no-payload' }
  }
  if (!snapshotOf(snapshot)) {
    return { written: false, reason: 'invalid' }
  }

  const key = cacheKeyFor(identity)
  const now = options.now ?? Date.now()
  const throttleMs = options.throttleMs ?? SNAPSHOT_WRITE_THROTTLE_MS
  const byteSize = options.byteSize ?? Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
  const sourceId = stringOrUndefined(identity.sourceId)
  const sourceName = stringOrUndefined(options.sourceName)
  const origin = normalizeSnapshotOrigin(identity.origin) || undefined
  const project = asString(identity.project)?.trim() || undefined

  try {
    const existing = await payload.find({
      collection: 'archview-snapshots',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      sort: '-fetchedAt',
      where: { key: { equals: key } },
    })
    const current = existing.docs[0] as unknown as Record<string, unknown> | undefined
    const currentFetchedAt = timestamp(current?.fetchedAt)

    if (
      current &&
      currentFetchedAt !== null &&
      now - currentFetchedAt < throttleMs
    ) {
      return { written: false, reason: 'throttled' }
    }

    if (current) {
      const stored = snapshotOf(current.snapshot)
      if (stored && stableStringify(stored) === stableStringify(snapshot)) {
        return { written: false, reason: 'unchanged' }
      }
    }

    const data: Record<string, unknown> = {
      key,
      snapshot,
      fetchedAt: new Date(now).toISOString(),
      byteSize,
      ...(sourceId ? { sourceId } : {}),
      ...(sourceName ? { sourceName } : {}),
      ...(origin ? { origin } : {}),
      ...(project ? { project } : {}),
    }

    if (current?.id !== undefined) {
      await payload.update({
        collection: 'archview-snapshots',
        id: current.id as string | number,
        data: data as never,
        overrideAccess: true,
      })
    } else {
      await payload.create({
        collection: 'archview-snapshots',
        data: data as never,
        overrideAccess: true,
      })
    }

    return { written: true }
  } catch (error) {
    console.warn(
      'ArchView snapshot cache write failed:',
      error instanceof Error ? error.message : error,
    )
    return { written: false, reason: 'error' }
  }
}
