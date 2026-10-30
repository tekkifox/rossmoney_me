import type { Payload } from 'payload'

import {
  archviewFetch,
  archviewSourceFetch,
  type ArchviewEnv,
  type ArchviewSourceCredentials,
} from './archviewAuth'
import {
  findDefaultArchviewSourceRecord,
  findEnabledArchviewSourceRecordByRef,
  type ArchviewSourceRecord,
} from './archviewSources'
import { asRecord, asString, isObjectLike } from './json'

export type ArchviewResolutionKind = 'relation' | 'legacy' | 'default' | 'env'

export type ResolvedArchviewSource = {
  kind: ArchviewResolutionKind
  origin: string
  project?: string
  credentials?: ArchviewSourceCredentials
}

export type PageSourceDeps = {
  payload?: Payload
  env?: ArchviewEnv
}

const relationRefs = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }
  if (typeof value === 'number') {
    return [String(value)]
  }
  if (!isObjectLike(value)) {
    return []
  }

  const refs: string[] = []
  const origin = asString(value.origin)
  if (origin) {
    refs.push(origin)
  }

  const id = value.id
  if (id !== undefined && id !== null) {
    refs.push(String(id))
  }

  // Defensive support for a `{ relationTo, value }` wrapper.
  if (value.value !== undefined && value.value !== null && value.value !== value) {
    refs.push(...relationRefs(value.value))
  }

  return refs
}

const resolveRelation = async (
  value: unknown,
  payload?: Payload,
): Promise<ResolvedArchviewSource | null> => {
  const refs = relationRefs(value)
  if (refs.length === 0) {
    return null
  }

  if (payload) {
    for (const ref of refs) {
      const record: ArchviewSourceRecord | null =
        await findEnabledArchviewSourceRecordByRef(payload, ref)
      if (record) {
        return {
          kind: 'relation',
          origin: record.origin,
          ...(record.project ? { project: record.project } : {}),
          credentials: record.credentials,
        }
      }
    }

    // A disabled, deleted or malformed relation is not a usable explicit
    // choice; fall through to the legacy URL and the default row.
    return null
  }

  const populatedOrigin = asString(asRecord(value).origin)
  if (populatedOrigin) {
    return { kind: 'relation', origin: populatedOrigin }
  }
  return null
}

/**
 * Resolves the ArchView instance a page's architecture panel should read.
 *
 * Precedence, matching the page editor:
 *   1. the page's `archviewSource` relation,
 *   2. the legacy `archviewUrl` text on the page or in its `data` payload,
 *   3. the collection's default row,
 *   4. `ARCHVIEW_URL` (and the older host aliases) as a bootstrap fallback.
 *
 * A relation or default row also carries its credentials, so server-side
 * renders can authenticate to that source instead of calling it anonymously.
 */
export const resolvePageArchviewSource = async (
  page: unknown,
  section?: unknown,
  deps: PageSourceDeps = {},
): Promise<ResolvedArchviewSource | null> => {
  const pageRecord = asRecord(page)
  const sectionRecord = asRecord(section)
  const pageData = asRecord(pageRecord.data)

  for (const candidate of [
    pageRecord.archviewSource,
    sectionRecord.archviewSource,
    pageData.archviewSource,
  ]) {
    const resolved = await resolveRelation(candidate, deps.payload)
    if (resolved) {
      return resolved
    }
  }

  const legacy =
    asString(pageRecord.archviewUrl) ||
    asString(sectionRecord.archviewUrl) ||
    asString(pageData.archviewUrl) ||
    asString(pageData.archview) ||
    asString(sectionRecord.archview)
  if (legacy) {
    return { kind: 'legacy', origin: legacy }
  }

  if (deps.payload) {
    const record = await findDefaultArchviewSourceRecord(deps.payload)
    if (record) {
      return {
        kind: 'default',
        origin: record.origin,
        ...(record.project ? { project: record.project } : {}),
        credentials: record.credentials,
      }
    }
  }

  const env = deps.env ?? process.env
  const envOrigin =
    asString(env.ARCHVIEW_URL) || asString(env.ARCHVIEW_HOST) || asString(env.ARCHVIEW)
  if (envOrigin) {
    return { kind: 'env', origin: envOrigin }
  }

  return null
}

/**
 * Server-side fetch for a resolved page source. Credentials are attached only
 * when the chosen source is a collection row; legacy URL text and the
 * environment fallback keep the old `archviewFetch` behaviour.
 */
export const archviewFetchForPageSource = (
  target: string,
  init: RequestInit,
  resolved: ResolvedArchviewSource | null,
  deps: { env?: ArchviewEnv; fetchImpl?: typeof fetch } = {},
): Promise<Response> => {
  const env = deps.env ?? process.env
  const fetchImpl = deps.fetchImpl ?? fetch
  return resolved?.credentials
    ? archviewSourceFetch(target, init, resolved.credentials, fetchImpl)
    : archviewFetch(target, init, env, fetchImpl)
}
