import { NextResponse } from 'next/server'

import { archviewFetch } from '@/utilities/archviewAuth'
import { redactInternalEndpoints } from '@/utilities/redactInternalEndpoints'

// ArchView runs as a separate stack (archview.rossmoney.me), so there is no
// in-stack service name to fall back to. ARCHVIEW_URL points at the public
// deployment; localhost covers running ArchView beside `next dev`.
const CANDIDATE_HOSTS = [
  process.env.ARCHVIEW_URL,
  process.env.ARCHVIEW_HOST && (process.env.ARCHVIEW_HOST.startsWith('http') ? process.env.ARCHVIEW_HOST : `http://${process.env.ARCHVIEW_HOST}`),
  'http://localhost:8080',
].filter(Boolean) as string[]

type ArchviewSourceEnv = {
  ARCHVIEW_ALLOWED_SOURCES?: string
  ARCHVIEW_URL?: string
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
 * Resolves the optional `source` query parameter to the ArchView origin the
 * browser asked for.
 *
 * Only an `https:` origin that matches `ARCHVIEW_URL` or is listed in the
 * comma-separated `ARCHVIEW_ALLOWED_SOURCES` is accepted. Everything else
 * returns `null`, which keeps the proxy on its configured hosts.
 */
export const resolveArchviewSource = (
  raw: string | null | undefined,
  env: ArchviewSourceEnv = process.env,
): string | null => {
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

  const origin = url.origin
  const configured = originOf(env.ARCHVIEW_URL)
  if (configured && configured === origin) {
    return origin
  }

  return allowedSourceOrigins(env).has(origin) ? origin : null
}

const stripSource = (searchParams: URLSearchParams): string => {
  const forwarded = new URLSearchParams(searchParams)
  forwarded.delete('source')
  const query = forwarded.toString()
  return query ? `?${query}` : ''
}

async function tryFetch(url: string, timeoutMs = 5000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await archviewFetch(url, {
      headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' },
      cache: 'no-store',
      signal: controller.signal,
    })
    return res
  } finally {
    clearTimeout(id)
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const source = resolveArchviewSource(url.searchParams.get('source'))
  const search = stripSource(url.searchParams)

  const hosts = source
    ? Array.from(new Set([source, ...CANDIDATE_HOSTS].map((host) => host.replace(/\/$/, ''))))
    : CANDIDATE_HOSTS

  for (const host of hosts) {
    const target = `${host.replace(/\/$/, '')}/api/architecture${search}`
    try {
      const res = await tryFetch(target)
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
      console.warn('ArchView fetch attempt failed for', host, e instanceof Error ? e.message : e)
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
