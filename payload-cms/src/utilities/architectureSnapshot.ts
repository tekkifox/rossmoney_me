/**
 * Loads the ArchView snapshot a page template renders.
 *
 * Every architecture template needs the same steps: resolve the source the
 * page chose (relation, legacy URL text, collection default, then the
 * environment), fetch that source's `/api/architecture` endpoint with the
 * matching credentials, and redact the internal Docker endpoints before the
 * payload is rendered or embedded in the RSC response.
 *
 * Keeping this in one place means the homepage and the project pages render
 * the same snapshot shape, including the `endpoints` array that
 * `renderDiagram` annotates the API line with.
 */

import { unstable_cache } from 'next/cache'
import type { Payload } from 'payload'

import {
  archviewFetchForPageSource,
  resolvePageArchviewSource,
  isArchviewSourceFailure,
} from '@/utilities/archviewPageSource'
import type { ArchviewEnv } from '@/utilities/archviewAuth'
import {
  ARCHITECTURE_CACHE_REVALIDATE_SECONDS,
  ARCHITECTURE_CACHE_TAG,
  ARCHITECTURE_SNAPSHOT_TIMEOUT_MS,
  ARCHITECTURE_UPSTREAM_REVALIDATE_SECONDS,
} from '@/utilities/architectureCache'
import {
  cacheKeyFor,
  readCachedSnapshot,
  writeCachedSnapshot,
  type SnapshotCacheIdentity,
} from '@/utilities/architectureStore'
import { getSafePayload } from '@/utilities/getSafePayload'
import { redactInternalEndpoints } from '@/utilities/redactInternalEndpoints'

/** The fallback the templates have always used when no source resolves. */
const LOCAL_ARCHVIEW_URL = 'http://localhost:8080'

const snapshotOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/**
 * The cache identity for a source failure. A reference that is a URL keys by
 * origin; anything else is the collection row id.
 */
const failureIdentity = (
  ref: string,
  project?: string,
): SnapshotCacheIdentity | null => {
  const value = ref.trim()
  if (!value) {
    return null
  }
  return /^https?:\/\//i.test(value)
    ? { origin: value, project }
    : { sourceId: value, project }
}

export type ArchitectureSnapshotEnv = ArchviewEnv & {
  ARCHVIEW_HOST?: string
  ARCHVIEW?: string
}

export type ArchitectureSnapshotOptions = {
  /** Project slug appended as `?project=`. Templates that show the default snapshot omit it. */
  project?: string
  /** Page name used in the failure warning, for example `travelling`. */
  label?: string
  /**
   * Payload client for source resolution. Omit to resolve one through
   * `getSafePayload()`; pass `null` when only page data and the environment
   * should be consulted (tests, or a request with no database).
   */
  payload?: Payload | null
  env?: ArchitectureSnapshotEnv
  fetchImpl?: typeof fetch
}

/**
 * The same candidate order the templates used inline: the resolved source,
 * then `ARCHVIEW_URL`, `ARCHVIEW_HOST`, `ARCHVIEW`, and finally localhost.
 */
const fallbackOrigin = (env: ArchitectureSnapshotEnv): string =>
  env.ARCHVIEW_URL || env.ARCHVIEW_HOST || env.ARCHVIEW || LOCAL_ARCHVIEW_URL

const architectureURL = (origin: string, project?: string): string => {
  const base = `${origin.replace(/\/$/, '')}/api/architecture`
  if (!project) {
    return base
  }
  return `${base}?project=${encodeURIComponent(project)}`
}

/**
 * Fetches and redacts the snapshot for `page`/`section`.
 *
 * Returns `null` when no source answers, so templates keep their existing
 * degraded state ("Loading", "No snapshot returned") instead of throwing.
 */
export { isArchviewSourceFailure } from '@/utilities/archviewPageSource'

const loadArchitectureSnapshotUncached = async (
  page: unknown,
  section?: unknown,
  options: ArchitectureSnapshotOptions = {},
): Promise<Record<string, unknown> | null> => {
  const env = options.env ?? process.env
  const label = options.label ? ` for ${options.label}` : ' snapshot'
  let payload: Payload | null | undefined
  let fallbackKey: string | null = null

  try {
    payload =
      options.payload === undefined ? await getSafePayload() : options.payload
    const resolvedSource = await resolvePageArchviewSource(page, section, {
      // `null` is the "no database" signal; the resolver treats undefined the same.
      payload: payload ?? undefined,
    })

    if (isArchviewSourceFailure(resolvedSource)) {
      const ref = resolvedSource.ref
      const reason = resolvedSource.reason
      const identity = failureIdentity(ref, options.project)
      const cached = identity
        ? await readCachedSnapshot(payload, cacheKeyFor(identity), { env })
        : null
      if (cached) {
        console.warn(
          `ArchView source "${ref}" could not be used (${reason}); serving the cached snapshot.`,
        )
        return cached.snapshot
      }

      const message = `ArchView source "${ref}" could not be used: ${reason}.`
      return {
        archviewSourceFailure: true,
        reason,
        message,
        title: 'Architecture source unavailable',
        description: message,
      } as Record<string, unknown>
    }

    // The resolved row's project is what the browser poll and the sampler use,
    // so the page path requests it too. This keeps the cache key identical on
    // both paths instead of storing an unprojected and a projected copy.
    const project = options.project ?? resolvedSource?.project
    const origin = resolvedSource?.origin || fallbackOrigin(env)
    const identity: SnapshotCacheIdentity = {
      sourceId: resolvedSource?.id,
      origin,
      project,
    }
    const key = cacheKeyFor(identity)
    fallbackKey = key
    const url = architectureURL(origin, project)

    const response = await archviewFetchForPageSource(
      url,
      {
        // The snapshot is safe to share: it is public data and is redacted below.
        // The data cache normally owns the revalidation, but the upstream hint
        // keeps a direct call from becoming an implicit `no-store` fetch.
        next: { revalidate: ARCHITECTURE_UPSTREAM_REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(ARCHITECTURE_SNAPSHOT_TIMEOUT_MS),
      } as RequestInit,
      resolvedSource,
      { env, fetchImpl: options.fetchImpl },
    )

    if (!response.ok) {
      console.warn('ArchView returned', response.status, response.statusText, 'for', url)
      return (await readCachedSnapshot(payload, key, { env }))?.snapshot ?? null
    }

    const fetched = snapshotOf(await response.json())
    if (!fetched || fetched.degraded === true) {
      console.warn('ArchView returned an unusable snapshot for', url)
      return (await readCachedSnapshot(payload, key, { env }))?.snapshot ?? null
    }

    const snapshot = redactInternalEndpoints(fetched)
    // Only a successful, redacted live fetch may replace the last good row.
    await writeCachedSnapshot(payload, identity, snapshot, {
      sourceName: resolvedSource?.name,
    })
    return snapshot
  } catch (err) {
    // Invalid JSON, a timeout or a network error all land here. Serve the last
    // known good row when there is one; never overwrite it with the failure.
    console.warn(`Failed to fetch architecture${label}`, err)
    if (payload && fallbackKey) {
      return (await readCachedSnapshot(payload, fallbackKey, { env }))?.snapshot ?? null
    }
    return null
  }
}

/**
 * Shared data-cache entry for the expensive part of the render.
 *
 * The arguments are the page/section documents plus the explicit project and
 * label, so the cache key follows the page, its resolved source and the
 * requested project. A failure returns `null` and is cached for the same short
 * window, which keeps a broken upstream from being retried on every request.
 */
const cachedArchitectureSnapshot = unstable_cache(
  (page: unknown, section: unknown, project?: string, label?: string) =>
    loadArchitectureSnapshotUncached(page, section, { project, label }),
  ['architecture-snapshot'],
  {
    revalidate: ARCHITECTURE_CACHE_REVALIDATE_SECONDS,
    tags: [ARCHITECTURE_CACHE_TAG],
  },
)

export async function loadArchitectureSnapshot(
  page: unknown,
  section?: unknown,
  options: ArchitectureSnapshotOptions = {},
): Promise<Record<string, unknown> | null> {
  // Tests and callers that inject a Payload client, environment or fetch
  // implementation are deliberately uncached: they are exercising the fetch
  // contract, not the Next.js data cache.
  if (
    options.payload !== undefined ||
    options.env !== undefined ||
    options.fetchImpl !== undefined
  ) {
    return loadArchitectureSnapshotUncached(page, section, options)
  }

  return cachedArchitectureSnapshot(page, section, options.project, options.label)
}
