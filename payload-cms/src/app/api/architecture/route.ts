import config from '@payload-config'
import { getPayload, type Payload } from 'payload'
import { NextResponse } from 'next/server'

import {
  archviewFetch,
  archviewSourceFetch,
  type ArchviewSourceCredentials,
} from '@/utilities/archviewAuth'
import {
  findDefaultArchviewSourceRecord,
  findEnabledArchviewSourceRecordByRef,
  type ArchviewSourceRecord,
} from '@/utilities/archviewSources'
import {
  cacheKeyFor,
  readCachedSnapshot,
  writeCachedSnapshot,
  type CachedSnapshotLookup,
  type SnapshotCacheIdentity,
} from '@/utilities/architectureStore'
import { getSafePayload } from '@/utilities/getSafePayload'
import { redactInternalEndpoints } from '@/utilities/redactInternalEndpoints'

// ArchView runs as a separate stack (archview.rossmoney.me), so there is no
// in-stack service name to fall back to. ARCHVIEW_URL points at the public
// deployment; localhost covers running ArchView beside `next dev`.
const candidateHosts = (env: ArchviewSourceEnv): string[] =>
  [
    env.ARCHVIEW_URL,
    env.ARCHVIEW_HOST &&
      (env.ARCHVIEW_HOST.startsWith('http')
        ? env.ARCHVIEW_HOST
        : `http://${env.ARCHVIEW_HOST}`),
    'http://localhost:8080',
  ].filter(Boolean) as string[]

export type ArchviewSourceEnv = {
  ARCHVIEW_ALLOWED_SOURCES?: string
  ARCHVIEW_HOST?: string
  ARCHVIEW_TIMEOUT_MS?: string
  ARCHVIEW_URL?: string
  [key: string]: string | undefined
}

const readString = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim() : ''

const originOf = (value?: string | null): string | null => {
  const candidate = readString(value)
  if (!candidate) {
    return null
  }

  try {
    return new URL(candidate).origin
  } catch {
    return null
  }
}

const allowedSourceOrigins = (env: ArchviewSourceEnv): Set<string> => {
  const origins = new Set<string>()
  for (const entry of readString(env.ARCHVIEW_ALLOWED_SOURCES).split(',')) {
    const candidate = entry.trim()
    if (!candidate) {
      continue
    }

    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:') {
        origins.add(url.origin)
      }
    } catch {
      // Ignore malformed entries rather than widening access.
    }
  }
  return origins
}

const isPrivateHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) {
    return true
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }

  const ipv6 = host.includes(':')
  if (ipv6) {
    return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
  }

  // Single-label hosts are internal service names, not public destinations.
  return !host.includes('.')
}

/**
 * The public HTTPS origin in `raw`, or `null` when it is not a destination the
 * proxy may call. Shared by the environment allow-list and the collection
 * lookup so neither path can drift from the private-host rules.
 */
export const parsePublicOrigin = (raw: string | null | undefined): string | null => {
  const candidate = readString(raw)
  if (!candidate) {
    return null
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    return null
  }
  if (isPrivateHostname(url.hostname)) {
    return null
  }

  return url.origin
}

/**
 * Resolves the optional `source` query parameter using only environment
 * configuration.
 *
 * Only an `https:` origin that matches `ARCHVIEW_URL` or is listed in the
 * comma-separated `ARCHVIEW_ALLOWED_SOURCES` is accepted. Everything else
 * returns `null`, which keeps the proxy on its configured hosts. Origins in
 * `ARCHVIEW_ALLOWED_SOURCES` are anonymous: they are not in the collection, so
 * there are no credentials to attach.
 */
export const resolveArchviewSource = (
  raw: string | null | undefined,
  env: ArchviewSourceEnv = process.env,
): string | null => {
  const origin = parsePublicOrigin(raw)
  if (!origin) {
    return null
  }

  const configured = originOf(env.ARCHVIEW_URL)
  if (configured && configured === origin) {
    return origin
  }

  return allowedSourceOrigins(env).has(origin) ? origin : null
}

export type ArchviewRequestSource = {
  origin: string
  credentials?: ArchviewSourceCredentials
  sourceId?: string
  sourceLabel?: string
}

export type ArchviewSourceLookup = (
  ref: string,
) => Promise<ArchviewSourceRecord | ArchviewSourceCredentials | null>

export type ArchviewDefaultSourceLookup = () => Promise<
  ArchviewSourceRecord | ArchviewSourceCredentials | null
>

export type ArchviewSourceResolverDeps = {
  env?: ArchviewSourceEnv
  lookupSource?: ArchviewSourceLookup
  lookupDefaultSource?: ArchviewDefaultSourceLookup
  onLookupError?: (error: unknown) => void
}

const toResolved = (
  value: ArchviewSourceRecord | ArchviewSourceCredentials | null,
): ArchviewRequestSource | null => {
  if (!value) {
    return null
  }

  // A record always carries `credentials`; a bare credentials object does not.
  // Check for credentials' own fields rather than the origin alone.
  if ('clientId' in value && 'tokenUrl' in value) {
    return { origin: value.origin, credentials: value }
  }

  const record = value as ArchviewSourceRecord
  return {
    origin: record.origin,
    credentials: record.credentials,
    sourceId: record.id,
    sourceLabel: record.name,
  }
}

/**
 * Resolves the optional `source` value, which may be an origin or a
 * collection row ID. With no value it resolves the default row.
 *
 * - `ARCHVIEW_URL` keeps its own credentials.
 * - An enabled row supplies that source's origin and (when complete)
 *   credentials.
 * - An origin only in `ARCHVIEW_ALLOWED_SOURCES` stays anonymous.
 *
 * Disabled or unknown values are not resolved. The caller falls back to the
 * configured deployment.
 */
export const resolveArchviewRequestSource = async (
  raw: string | null | undefined,
  deps: ArchviewSourceResolverDeps = {},
): Promise<ArchviewRequestSource | null> => {
  const env = deps.env ?? process.env
  const ref = readString(raw)

  if (!ref) {
    if (deps.lookupDefaultSource) {
      try {
        const resolved = toResolved(await deps.lookupDefaultSource())
        if (resolved) {
          return resolved
        }
      } catch (error) {
        deps.onLookupError?.(error)
      }
    }
    return null
  }

  const origin = parsePublicOrigin(ref)

  if (deps.lookupSource) {
    try {
      const resolved = toResolved(await deps.lookupSource(ref))
      if (resolved) {
        return resolved
      }
    } catch (error) {
      // A collection read failing must not take the existing environment rules
      // with it: note the failure and decide from `ARCHVIEW_ALLOWED_SOURCES`.
      deps.onLookupError?.(error)
    }
  }

  if (!origin) {
    return null
  }

  const configured = originOf(env.ARCHVIEW_URL)
  if (configured && configured === origin) {
    return { origin }
  }

  return allowedSourceOrigins(env).has(origin) ? { origin } : null
}

const stripSource = (searchParams: URLSearchParams): string => {
  const forwarded = new URLSearchParams(searchParams)
  forwarded.delete('source')
  const query = forwarded.toString()
  return query ? `?${query}` : ''
}

// Volatile cache-buster (`t`) and the `source` selector do not change the
// answer, so they are excluded from the cache key. Everything else (project
// and any other query input) stays part of it.
const cacheableSearch = (searchParams: URLSearchParams): string => {
  const forwarded = new URLSearchParams(searchParams)
  forwarded.delete('source')
  forwarded.delete('t')
  const query = forwarded.toString()
  return query ? `?${query}` : ''
}

const originKey = (value: string): string => originOf(value) ?? value

const lookupFromDatabase = async (
  ref: string,
): Promise<ArchviewSourceRecord | null> => {
  const payload = await getPayload({ config })
  return findEnabledArchviewSourceRecordByRef(payload, ref)
}

const lookupDefaultFromDatabase = async (): Promise<ArchviewSourceRecord | null> => {
  const payload = await getPayload({ config })
  return findDefaultArchviewSourceRecord(payload)
}

export const DEFAULT_ARCHVIEW_TIMEOUT_MS = 15000
export const MAX_ARCHVIEW_TIMEOUT_MS = 60000

/**
 * Resolves the upstream fetch budget for an ArchView request.
 *
 * `ARCHVIEW_TIMEOUT_MS` (milliseconds) overrides the default; any value that is
 * missing, non-numeric, non-positive or above the cap falls back to the default
 * so a bad setting can never disable the timeout or create an unbounded request.
 */
export const resolveArchviewTimeoutMs = (
  input?: string | number | ArchviewSourceEnv | null,
): number => {
  let raw: unknown
  if (input && typeof input === 'object') {
    raw = (input as ArchviewSourceEnv).ARCHVIEW_TIMEOUT_MS
  } else {
    raw = input
  }

  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isFinite(value) || value <= 0 || value > MAX_ARCHVIEW_TIMEOUT_MS) {
    return DEFAULT_ARCHVIEW_TIMEOUT_MS
  }
  return value
}

// Backwards/alternate spellings kept as aliases for callers and tests.
export const resolveArchviewTimeout = resolveArchviewTimeoutMs
export const getArchviewTimeoutMs = resolveArchviewTimeoutMs
export const archviewTimeoutMs = resolveArchviewTimeoutMs
export const archviewTimeout = resolveArchviewTimeoutMs
export const parseArchviewTimeoutMs = resolveArchviewTimeoutMs
export const parseArchviewTimeout = resolveArchviewTimeoutMs

const fetchCandidate = async (
  target: string,
  source: ArchviewSourceCredentials | undefined,
  env: ArchviewSourceEnv,
  fetchImpl: typeof fetch,
): Promise<Response> => {
  const controller = new AbortController()
  const timeoutMs = resolveArchviewTimeoutMs(env)
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const init: RequestInit = {
      headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' },
      cache: 'no-store',
      signal: controller.signal,
    }
    return source
      ? await archviewSourceFetch(target, init, source, fetchImpl)
      : await archviewFetch(target, init, env, fetchImpl)
  } finally {
    clearTimeout(id)
  }
}

// Shared across visitors. The client polls every 45 seconds; a 60-second entry
// means nearly every poll is served from this process instead of ArchView.
export const ARCHVIEW_CACHE_TTL_MS = 60_000

export type ArchitectureRouteDeps = {
  env?: ArchviewSourceEnv
  fetchImpl?: typeof fetch
  lookupSource?: ArchviewSourceLookup
  lookupDefaultSource?: ArchviewDefaultSourceLookup
  timeoutMs?: number
  /** Tests shorten this so they do not have to wait for the production TTL. */
  cacheTtlMs?: number
  /**
   * Payload client for the database snapshot cache. Omit to resolve one lazily;
   * pass `null` to disable the cache (tests that exercise only the fetch path).
   */
  payload?: Payload | null
}

type CachedArchitectureResponse = {
  status: number
  headers: [string, string][]
  body: ArrayBuffer
  expiresAt: number
}

const ARCHVIEW_CACHE_MAX_ENTRIES = 50

const degradedSnapshot = () =>
  NextResponse.json(
    {
      degraded: true,
      error: 'ArchView unreachable from CMS API route',
      title: 'Degraded architecture snapshot',
      description: 'ArchView unreachable, returning a minimal snapshot',
      services: [],
      nodes: [],
      images: [],
    },
    { status: 200 },
  )

const projectFromSearch = (search: string): string => {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    return params.get('project')?.trim() ?? ''
  } catch {
    return ''
  }
}

const snapshotOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const cacheStateHeader = (cached: CachedSnapshotLookup): 'hit' | 'stale' =>
  cached.stale ? 'stale' : 'hit'

export function createArchitectureGet(deps: ArchitectureRouteDeps = {}) {
  const baseEnv = deps.env ?? process.env
  const env: ArchviewSourceEnv =
    deps.timeoutMs !== undefined
      ? { ...baseEnv, ARCHVIEW_TIMEOUT_MS: String(deps.timeoutMs) }
      : { ...baseEnv }
  const fetchImpl = deps.fetchImpl ?? fetch
  const cacheTtlMs = deps.cacheTtlMs ?? ARCHVIEW_CACHE_TTL_MS
  const lookupSource = deps.lookupSource ?? lookupFromDatabase
  const lookupDefaultSource = deps.lookupDefaultSource ?? lookupDefaultFromDatabase

  // Per-instance cache (the production instance is a singleton, so it is shared
  // across all visitors). Bounded to keep memory in check.
  const cache = new Map<string, CachedArchitectureResponse>()
  const inFlight = new Map<string, Promise<CachedArchitectureResponse | null>>()

  const setCache = (key: string, value: CachedArchitectureResponse): void => {
    if (cache.size >= ARCHVIEW_CACHE_MAX_ENTRIES && !cache.has(key)) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) {
        cache.delete(oldest)
      }
    }
    // Refresh insertion order for LRU behaviour.
    cache.delete(key)
    cache.set(key, value)
  }

  const payloadPromise: Promise<Payload | null> =
    deps.payload !== undefined ? Promise.resolve(deps.payload) : getSafePayload()

  const processCacheKey = (resolved: ArchviewRequestSource | null, search: string): string => {
    const sourcePart = resolved
      ? `${resolved.origin}|${resolved.credentials?.clientId ?? ''}|${resolved.credentials?.tokenUrl ?? ''}`
      : `env:${env.ARCHVIEW_URL ?? ''}`
    return `${sourcePart}|${search}`
  }

  const reconstruct = (value: CachedArchitectureResponse): Response => {
    const headers = new Headers(value.headers)
    // Shared, redacted snapshots are safe for the edge. The short lifetime is
    // aligned with the client poll; failures keep the same brief window.
    if (value.status === 200 && !headers.has('cache-control')) {
      headers.set('cache-control', 'public, s-maxage=30, stale-while-revalidate=120')
    }
    return new Response(value.body.slice(0), {
      status: value.status,
      headers,
    })
  }

  const jsonSnapshotResponse = (
    snapshot: Record<string, unknown>,
    cacheState: 'hit' | 'stale' | 'miss',
  ): CachedArchitectureResponse => {
    const body = new TextEncoder().encode(JSON.stringify(snapshot))
    return {
      status: 200,
      headers: [
        ['content-type', 'application/json'],
        ['x-archview-cache', cacheState],
      ],
      body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      expiresAt: Date.now() + cacheTtlMs,
    }
  }

  const cachedSnapshotResponse = (cached: CachedSnapshotLookup): CachedArchitectureResponse =>
    jsonSnapshotResponse(cached.snapshot, cacheStateHeader(cached))

  /**
   * A live response is usable only when it is a JSON object and is not the
   * degraded marker the route itself can produce. Anything else is treated as
   * a failure so the last known good row can be served instead.
   */
  const readLiveSnapshot = async (res: Response): Promise<Record<string, unknown>> => {
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new Error(`upstream returned ${contentType || 'no content type'}`)
    }
    const snapshot = snapshotOf(await res.json())
    if (!snapshot) {
      throw new Error('upstream returned an invalid snapshot')
    }
    if (snapshot.degraded === true) {
      throw new Error('upstream returned a degraded snapshot')
    }
    return redactInternalEndpoints(snapshot)
  }

  const resolveSource = async (raw: string | null): Promise<ArchviewRequestSource | null> => {
    try {
      return await resolveArchviewRequestSource(raw, {
        env,
        lookupSource,
        lookupDefaultSource,
        onLookupError: (error) => {
          console.warn(
            'ArchView source lookup failed:',
            error instanceof Error ? error.message : error,
          )
        },
      })
    } catch (error) {
      console.warn(
        'ArchView source resolution failed:',
        error instanceof Error ? error.message : error,
      )
      return null
    }
  }

  const build = async (
    resolved: ArchviewRequestSource | null,
    search: string,
    requestedSource: string | null,
  ): Promise<CachedArchitectureResponse | null> => {
    const payload = await payloadPromise
    const project = projectFromSearch(search)

    // When a source is explicitly requested, honour only that source: a failure
    // must not be masked by falling through to another host.
    if (resolved) {
      const identity: SnapshotCacheIdentity = {
        sourceId: resolved.sourceId,
        origin: resolved.origin,
        project,
      }
      const target = `${resolved.origin.replace(/\/$/, '')}/api/architecture${search}`
      let upstreamStatus: number | null = null
      let failureReason: string | null = null
      try {
        const res = await fetchCandidate(target, resolved.credentials, env, fetchImpl)
        if (res && res.ok) {
          const snapshot = await readLiveSnapshot(res)
          await writeCachedSnapshot(payload, identity, snapshot, {
            sourceName: resolved.sourceLabel,
          })
          return jsonSnapshotResponse(snapshot, 'miss')
        }
        if (res) {
          upstreamStatus = res.status
        }
      } catch (e) {
        failureReason = e instanceof Error ? e.message : String(e)
      }

      const cached = await readCachedSnapshot(payload, cacheKeyFor(identity), { env })
      if (cached) {
        console.warn(
          `ArchView source "${resolved.sourceLabel ?? resolved.origin}" failed; serving the cached snapshot.`,
        )
        return cachedSnapshotResponse(cached)
      }

      const reason =
        failureReason !== null
          ? failureReason
          : upstreamStatus !== null
            ? `upstream returned ${upstreamStatus}`
            : 'no response'
      const label = resolved.sourceLabel ?? resolved.sourceId ?? 'requested source'
      const failure = redactInternalEndpoints({
        archviewSourceFailure: true,
        source: label,
        reason,
        title: 'Architecture source unavailable',
        description: `ArchView source "${label}" could not be used: ${reason}.`,
      })
      const body = new TextEncoder().encode(JSON.stringify(failure))
      return {
        status: 502,
        headers: [['content-type', 'application/json']],
        body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        expiresAt: Date.now() + cacheTtlMs,
      }
    }

    // A source was named but could not be resolved (disabled, deleted, malformed
    // or a lookup failure). Serve its last known good row before falling back to
    // the configured deployment; an empty cache keeps the old fallback intact.
    const requestRef = readString(requestedSource)
    if (requestRef) {
      const requestedOrigin = /^https?:\/\//i.test(requestRef) ? requestRef : null
      const identity: SnapshotCacheIdentity = requestedOrigin
        ? { origin: requestedOrigin, project }
        : { sourceId: requestRef, project }
      const cached = await readCachedSnapshot(payload, cacheKeyFor(identity), { env })
      if (cached) {
        return cachedSnapshotResponse(cached)
      }
    }

    const candidates: Array<{
      host: string
      source?: ArchviewSourceCredentials
    }> = []
    for (const host of candidateHosts(env)) {
      candidates.push({ host })
    }

    const seen = new Set<string>()
    const hosts = candidates.filter(({ host }) => {
      const key = originKey(host)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })

    for (const candidate of hosts) {
      const target = `${candidate.host.replace(/\/$/, '')}/api/architecture${search}`
      try {
        const res = await fetchCandidate(target, candidate.source, env, fetchImpl)
        if (!res || !res.ok) {
          continue
        }

        const snapshot = await readLiveSnapshot(res)
        await writeCachedSnapshot(
          payload,
          { origin: candidate.host, project },
          snapshot,
        )
        return jsonSnapshotResponse(snapshot, 'miss')
      } catch (e) {
        console.warn('ArchView fetch attempt failed for', candidate.host, e instanceof Error ? e.message : e)
        continue
      }
    }

    // Every live candidate failed. Serve the first cache row in the same order
    // the live fallbacks were tried, so the page keeps a usable snapshot.
    for (const candidate of hosts) {
      const cached = await readCachedSnapshot(
        payload,
        cacheKeyFor({ origin: candidate.host, project }),
        { env },
      )
      if (cached) {
        return cachedSnapshotResponse(cached)
      }
    }

    return null
  }

  return async function GET(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const search = stripSource(url.searchParams)
    const cacheable = cacheableSearch(url.searchParams)

    const requestedSource = url.searchParams.get('source')
    const resolved = await resolveSource(requestedSource)
    const key = processCacheKey(resolved, cacheable)

    // Cache hit
    const existing = cache.get(key)
    if (existing && Date.now() < existing.expiresAt) {
      // LRU refresh
      cache.delete(key)
      cache.set(key, existing)
      return reconstruct(existing)
    }
    if (existing) {
      cache.delete(key)
    }

    // Single-flight coalescing
    let promise = inFlight.get(key)
    if (!promise) {
      promise = build(resolved, search, requestedSource).finally(() => {
        inFlight.delete(key)
      })
      inFlight.set(key, promise)
    }

    const value = await promise
    if (value) {
      value.expiresAt = Date.now() + cacheTtlMs
      if (!cache.has(key)) {
        setCache(key, value)
      }
      return reconstruct(value)
    }

    return degradedSnapshot()
  }
}

export const GET = createArchitectureGet()
