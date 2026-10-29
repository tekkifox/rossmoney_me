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

import type { Payload } from 'payload'

import {
  archviewFetchForPageSource,
  resolvePageArchviewSource,
} from '@/utilities/archviewPageSource'
import type { ArchviewEnv } from '@/utilities/archviewAuth'
import { getSafePayload } from '@/utilities/getSafePayload'
import { redactInternalEndpoints } from '@/utilities/redactInternalEndpoints'

/** The fallback the templates have always used when no source resolves. */
const LOCAL_ARCHVIEW_URL = 'http://localhost:8080'

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
export async function loadArchitectureSnapshot(
  page: unknown,
  section?: unknown,
  options: ArchitectureSnapshotOptions = {},
): Promise<Record<string, unknown> | null> {
  const env = options.env ?? process.env
  const label = options.label ? ` for ${options.label}` : ' snapshot'

  try {
    const payload =
      options.payload === undefined ? await getSafePayload() : options.payload
    const resolvedSource = await resolvePageArchviewSource(page, section, {
      // `null` is the "no database" signal; the resolver treats undefined the same.
      payload: payload ?? undefined,
    })
    const url = architectureURL(
      resolvedSource?.origin || fallbackOrigin(env),
      options.project,
    )

    const response = await archviewFetchForPageSource(
      url,
      { cache: 'no-store' },
      resolvedSource,
      { env, fetchImpl: options.fetchImpl },
    )

    if (!response.ok) {
      console.warn('ArchView returned', response.status, response.statusText, 'for', url)
      return null
    }

    return redactInternalEndpoints(
      (await response.json()) as Record<string, unknown>,
    )
  } catch (err) {
    console.warn(`Failed to fetch architecture${label}`, err)
    return null
  }
}
