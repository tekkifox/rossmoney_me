import config from '@payload-config'
import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

import {
  archviewFetch,
  archviewSourceFetch,
  type ArchviewSourceCredentials,
} from '@/utilities/archviewAuth'
import { findEnabledArchviewSource } from '@/utilities/archviewSources'
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
}

export type ArchviewSourceResolverDeps = {
  env?: ArchviewSourceEnv
  lookupSource?: (origin: string) => Promise<ArchviewSourceCredentials | null>
  onLookupError?: (error: unknown) => void
}

/**
 * Resolves `source` against the enabled collection rows first, then the
 * existing environment rules.
 *
 * - `ARCHVIEW_URL` keeps its own credentials.
 * - An enabled row supplies that source's credentials.
 * - An origin only in `ARCHVIEW_ALLOWED_SOURCES` stays anonymous.
 *
 * Disabled or unknown origins are not resolved. The caller falls back to the
 * configured deployment exactly as it did before the collection existed.
 */
export const resolveArchviewRequestSource = async (
  raw: string | null | undefined,
  deps: ArchviewSourceResolverDeps = {},
): Promise<ArchviewRequestSource | null> => {
  const origin = parsePublicOrigin(raw)
  if (!origin) {
    return null
  }

  const env = deps.env ?? process.env
  const configured = originOf(env.ARCHVIEW_URL)
  if (configured && configured === origin) {
    return { origin }
  }

  if (deps.lookupSource) {
    try {
      const credentials = await deps.lookupSource(origin)
      if (credentials) {
        return { origin, credentials }
      }
    } catch (error) {
      // A collection read failing must not take the existing environment rules
      // with it: note the failure and decide from `ARCHVIEW_ALLOWED_SOURCES`.
      deps.onLookupError?.(error)
    }
  }

  return allowedSourceOrigins(env).has(origin) ? { origin } : null
}

const stripSource = (searchParams: URLSearchParams): string => {
  const forwarded = new URLSearchParams(searchParams)
  forwarded.delete('source')
  const query = forwarded.toString()
  return query ? `?${query}` : ''
}

const originKey = (value: string): string => originOf(value) ?? value

const lookupFromDatabase = async (
  origin: string,
): Promise<ArchviewSourceCredentials | null> => {
  const payload = await getPayload({ config })
  return findEnabledArchviewSource(payload, origin)
}

const TIMEOUT_MS = 5000

const fetchCandidate = async (
  target: string,
  source: ArchviewSourceCredentials | undefined,
  env: ArchviewSourceEnv,
  fetchImpl: typeof fetch,
): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS)
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

export type ArchitectureRouteDeps = {
  env?: ArchviewSourceEnv
  fetchImpl?: typeof fetch
  lookupSource?: (origin: string) => Promise<ArchviewSourceCredentials | null>
}

export function createArchitectureGet(deps: ArchitectureRouteDeps = {}) {
  const env = deps.env ?? process.env
  const fetchImpl = deps.fetchImpl ?? fetch
  const lookupSource = deps.lookupSource ?? lookupFromDatabase

  return async function GET(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const search = stripSource(url.searchParams)

    let resolved: ArchviewRequestSource | null = null
    try {
      resolved = await resolveArchviewRequestSource(url.searchParams.get('source'), {
        env,
        lookupSource,
        onLookupError: (error) => {
          console.warn(
            'ArchView source lookup failed:',
            error instanceof Error ? error.message : error,
          )
        },
      })
    } catch (error) {
      // Defensive: resolution only reads the environment after a lookup
      // failure, so this is not expected. Falling back keeps the proxy up.
      console.warn(
        'ArchView source resolution failed:',
        error instanceof Error ? error.message : error,
      )
    }

    const candidates: Array<{
      host: string
      source?: ArchviewSourceCredentials
    }> = []
    if (resolved) {
      candidates.push({ host: resolved.origin, source: resolved.credentials })
    }
    for (const host of candidateHosts(env)) {
      candidates.push({ host })
    }

    // Keep the requested (possibly authenticated) origin first and try each
    // other origin only once.
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
        if (!res) continue

        const contentType = res.headers.get('content-type') || ''
        if (!res.ok) {
          // try next host
          continue
        }

        if (contentType.includes('application/json')) {
          const data = await res.json()
          return NextResponse.json(redactInternalEndpoints(data))
        }

        const text = await res.text()
        return new NextResponse(redactInternalEndpoints(text), {
          headers: { 'content-type': contentType },
        })
      } catch (e) {
        // try next candidate host
        console.warn('ArchView fetch attempt failed for', candidate.host, e instanceof Error ? e.message : e)
        continue
      }
    }

    // All attempts failed — return degraded snapshot
    const message = 'ArchView unreachable from CMS API route'
    return NextResponse.json(
      {
        degraded: true,
        error: message,
        title: 'Degraded architecture snapshot',
        description: 'ArchView unreachable, returning a minimal snapshot',
        services: [],
        nodes: [],
        images: [],
      },
      { status: 200 },
    )
  }
}

export const GET = createArchitectureGet()
