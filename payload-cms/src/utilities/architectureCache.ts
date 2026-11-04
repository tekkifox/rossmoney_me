import { revalidateTag } from 'next/cache'

/**
 * Cache policy for the server-rendered architecture snapshot.
 *
 * The snapshot changes slowly (ArchView samples telemetry), so the expensive
 * authenticated upstream call is shared through the Next.js data cache instead
 * of running on every request. Editors get a fresh snapshot immediately when
 * they change a page or an ArchView source because both collections invalidate
 * this tag.
 */
export const ARCHITECTURE_CACHE_TAG = 'architecture'

/** How long a rendered snapshot (including a failure) stays in the data cache. */
export const ARCHITECTURE_CACHE_REVALIDATE_SECONDS = 45

/** Let the upstream response be reused by the data cache for a little less. */
export const ARCHITECTURE_UPSTREAM_REVALIDATE_SECONDS = 30

/**
 * A stuck ArchView must never hold the page response. Three seconds is well
 * above the observed ~2.2 s snapshot time and keeps a failure below the point
 * where a visitor would rather see the degraded panel.
 */
export const ARCHITECTURE_SNAPSHOT_TIMEOUT_MS = 3000

/**
 * Invalidates the cached snapshot. Collection hooks run during seeding and
 * scripts as well as inside requests, so a missing Next.js cache context must
 * not turn an editor save into a failed save.
 */
export const revalidateArchitectureCache = (): void => {
  try {
    revalidateTag(ARCHITECTURE_CACHE_TAG, 'max')
  } catch {
    // No request/cache context (seed, CLI or test): nothing to invalidate.
  }
}
