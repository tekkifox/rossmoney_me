import { lookup } from 'node:dns/promises'

import { DEFAULT_SITE_URL } from './siteURL'

/**
 * Keep the public dev preview off the open internet.
 *
 * `DEV_GATE=1` turns this on; with the variable unset or any other value every
 * request passes through exactly as before. Only the Vercel preview target sets
 * it, so production and local development never resolve the VPN name.
 *
 * A request is allowed when its client address is one of the addresses the
 * WireGuard endpoint currently resolves to, or when it matches an entry in
 * `DEV_GATE_ALLOW`. Everything else is sent to the live site's home page.
 *
 * The endpoint name is configuration (`DEV_GATE_HOST`), not a constant in this
 * repository: this repository is public, and the deployment's real hosts stay
 * in the deployment's environment. The address is resolved at request time and
 * cached briefly, because the endpoint's DNS record has a short TTL and follows
 * the host's public address. `DEV_GATE_ALLOW` is the escape hatch for anything
 * that cannot use the VPN.
 *
 * This is Next.js middleware in the Next 16 sense: Next renamed the
 * `middleware.ts` convention to `proxy.ts`, and this app has already migrated.
 * The gate lives here so the routing hook stays a thin list of jobs; it is
 * called from `src/proxy.ts`. Adding a second `middleware.ts` next to
 * `proxy.ts` is a build error in Next 16.
 */

/** Temporary redirect: a visitor who joins the VPN can retry the same URL. */
export const DEV_GATE_REDIRECT_STATUS = 307 as const

/** Short enough to follow the endpoint, long enough to avoid a lookup per request. */
export const DEV_GATE_ADDRESS_TTL_MS = 3 * 60_000

/**
 * On a failed lookup, remember the failure briefly. The cache is per instance,
 * so this is only a guard against hammering DNS from one warm function.
 */
const DEV_GATE_FAILURE_TTL_MS = 30_000

/**
 * Paths that must never be gated. The nightly dev sync authenticates against
 * this site's API from another host whose address is not the VPN's, and the
 * media backfill reads `/media` (and `/api/media`); gating either would break
 * the refresh. `/_next` and static files are build output and images, not
 * browsable pages.
 *
 * Do not broaden these exemptions to the public pages. The point of the gate
 * is that a non-VPN visitor cannot browse the preview; the API and its assets
 * are deliberately available so automation keeps working.
 */
const DEV_GATE_EXEMPT_PREFIXES = ['/api', '/_next', '/media'] as const

/**
 * Public files in `payload-cms/public` are served directly by Next. They are
 * not pages, so redirecting them would break images, fonts, the sitemap and
 * the security text even for an allowed visitor's browser. Match a real file
 * extension rather than every path containing a dot.
 */
const DEV_GATE_STATIC_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'css',
  'doc',
  'docx',
  'eot',
  'gif',
  'gz',
  'ico',
  'jpeg',
  'jpg',
  'js',
  'json',
  'map',
  'm4a',
  'mp3',
  'mp4',
  'oga',
  'ogg',
  'ogv',
  'otf',
  'pdf',
  'png',
  'svg',
  'ttf',
  'txt',
  'wasm',
  'webmanifest',
  'webm',
  'webp',
  'woff',
  'woff2',
  'xml',
  'zip',
])

export type DevGateEnv = {
  DEV_GATE?: string | undefined
  DEV_GATE_HOST?: string | undefined
  DEV_GATE_ALLOW?: string | undefined
}

export type DevGateDecision =
  | {
      action: 'allow'
      reason: 'disabled' | 'exempt' | 'vpn' | 'allowlist'
    }
  | {
      action: 'redirect'
      reason: 'not-allowed'
      status: typeof DEV_GATE_REDIRECT_STATUS
      location: string
    }

export type AddressLookup = (hostname: string) => Promise<string[]>

export type MgmtAddressResolverOptions = {
  hostname?: string
  lookup?: AddressLookup
  ttlMs?: number
  now?: () => number
}

type ParsedAddress = {
  family: 4 | 6
  bytes: number[]
}

const defaultLookup: AddressLookup = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true })
  return results.map((result) => result.address)
}

/**
 * Build a resolver with its own cache. The default resolver is used by the
 * proxy; tests inject `lookup` (and a clock) so they never touch real DNS.
 */
export function createMgmtAddressResolver(
  options: MgmtAddressResolverOptions = {},
): () => Promise<string[]> {
  const hostname = (options.hostname ?? process.env.DEV_GATE_HOST)?.trim()
  const resolve = options.lookup ?? defaultLookup
  const ttlMs = options.ttlMs ?? DEV_GATE_ADDRESS_TTL_MS
  const now = options.now ?? Date.now

  // `DEV_GATE=1` without a host cannot allow anyone through the VPN path. Fail
  // closed rather than guessing a default name.
  if (!hostname) {
    return async () => {
      warnMissingHostname()
      return []
    }
  }

  let cached: { addresses: string[]; expiresAt: number } | null = null
  let pending: Promise<string[]> | null = null
  let lastFailureWarningAt = 0

  return async () => {
    const current = now()
    if (cached && current < cached.expiresAt) {
      return cached.addresses
    }

    // A cold cache under load should produce one lookup, not one per request.
    if (pending) {
      return pending
    }

    pending = (async () => {
      try {
        const addresses = [
          ...new Set(
            (await resolve(hostname))
              .map((address) => address.trim())
              .filter((address) => parseAddress(address) !== null),
          ),
        ]

        if (addresses.length === 0) {
          throw new Error('no usable addresses')
        }

        cached = { addresses, expiresAt: now() + ttlMs }
        return addresses
      } catch {
        // Fail closed: if the VPN name cannot be resolved, only explicit
        // DEV_GATE_ALLOW entries pass. Cache the failure briefly so a DNS
        // outage does not turn every request into a lookup.
        cached = { addresses: [], expiresAt: now() + Math.min(ttlMs, DEV_GATE_FAILURE_TTL_MS) }

        if (now() - lastFailureWarningAt >= 60_000) {
          lastFailureWarningAt = now()
          console.warn(
            `[dev-gate] could not resolve ${hostname}; denying clients outside DEV_GATE_ALLOW`,
          )
        }

        return []
      } finally {
        pending = null
      }
    })()

    return pending
  }
}

let defaultResolver: { hostname: string; resolve: () => Promise<string[]> } | null = null
let lastMissingHostnameWarningAt = 0

/**
 * Resolve the configured endpoint lazily so a changed environment (a test, or
 * a platform that injects variables at runtime) is picked up without a stale
 * module-level cache.
 */
function resolveDefaultAddresses(): Promise<string[]> {
  const hostname = process.env.DEV_GATE_HOST?.trim()
  if (!hostname) {
    warnMissingHostname()
    return Promise.resolve([])
  }

  if (!defaultResolver || defaultResolver.hostname !== hostname) {
    defaultResolver = { hostname, resolve: createMgmtAddressResolver({ hostname }) }
  }

  return defaultResolver.resolve()
}

function warnMissingHostname(): void {
  const now = Date.now()
  if (now - lastMissingHostnameWarningAt < 60_000) {
    return
  }

  lastMissingHostnameWarningAt = now
  console.warn('[dev-gate] DEV_GATE=1 but DEV_GATE_HOST is unset; denying clients outside DEV_GATE_ALLOW')
}

/**
 * The gate is strictly opt-in. Anything except exactly `1` (for example `true`
 * or a leftover empty value) leaves the app unchanged.
 */
export function isDevGateEnabled(env: DevGateEnv = process.env): boolean {
  return env.DEV_GATE === '1'
}

/**
 * `/api/*`, `/_next/*`, `/media/*` and public files never redirect. See the
 * comment on `DEV_GATE_EXEMPT_PREFIXES` for why the API in particular must stay
 * reachable from outside the VPN.
 */
export function isDevGateExemptPath(pathname: string): boolean {
  for (const prefix of DEV_GATE_EXEMPT_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return true
    }
  }

  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
  const dot = lastSegment.lastIndexOf('.')
  if (dot <= 0) {
    return false
  }

  return DEV_GATE_STATIC_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase())
}

/**
 * Vercel terminates TLS and writes the browser's address as the first entry of
 * `x-forwarded-for`. Later entries are proxies the request passed through and
 * are not the visitor. A missing or blank header is not allowed: the gate must
 * not fall back to another header or to a shared proxy address.
 */
export function forwardedClientAddress(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (!forwarded) {
    return null
  }

  const first = forwarded.split(',')[0]?.trim()
  return first ? first : null
}

/** Parse `DEV_GATE_ALLOW`; blank entries are ignored. Invalid entries match nothing. */
export function parseAddressAllowList(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * True when `address` is the same host as `entry`, where `entry` is either a
 * literal address or a CIDR block. IPv4 and IPv6 are both supported.
 */
export function addressMatches(address: string, entry: string): boolean {
  const candidate = parseAddress(address)
  if (!candidate) {
    return false
  }

  const trimmed = entry.trim()
  if (!trimmed) {
    return false
  }

  const slash = trimmed.indexOf('/')
  if (slash === -1) {
    const expected = parseAddress(trimmed)
    return expected !== null && addressesEqual(candidate, expected)
  }

  const network = parseAddress(trimmed.slice(0, slash))
  const prefixText = trimmed.slice(slash + 1)
  if (!network || !/^\d{1,3}$/.test(prefixText)) {
    return false
  }

  return matchesPrefix(candidate, network, Number(prefixText))
}

export type EvaluateDevGateInput = {
  headers: Headers
  pathname: string
  env?: DevGateEnv
  /** Injectable for tests and for callers that already resolved the name. */
  resolveAddresses?: () => Promise<string[]>
}

/**
 * Decide what the proxy should do with this request. Redirects to the live home
 * page rather than preserving the path: most preview paths do not exist on the
 * live site, and a 404 there would be a worse landing than the home page.
 */
export async function evaluateDevGate(input: EvaluateDevGateInput): Promise<DevGateDecision> {
  const env = input.env ?? process.env

  if (!isDevGateEnabled(env)) {
    return { action: 'allow', reason: 'disabled' }
  }

  if (isDevGateExemptPath(input.pathname)) {
    return { action: 'allow', reason: 'exempt' }
  }

  const address = forwardedClientAddress(input.headers)
  if (!address || !parseAddress(address)) {
    return redirectToLive()
  }

  if (parseAddressAllowList(env.DEV_GATE_ALLOW).some((entry) => addressMatches(address, entry))) {
    return { action: 'allow', reason: 'allowlist' }
  }

  const resolved = await (input.resolveAddresses ?? resolveDefaultAddresses)().catch(() => [])

  if (resolved.some((entry) => addressMatches(address, entry))) {
    return { action: 'allow', reason: 'vpn' }
  }

  return redirectToLive()
}

function redirectToLive(): DevGateDecision {
  return {
    action: 'redirect',
    reason: 'not-allowed',
    status: DEV_GATE_REDIRECT_STATUS,
    location: DEFAULT_SITE_URL,
  }
}

/** Strip `[v6]:port` brackets and `v4:port`, both of which proxies sometimes add. */
function stripAddressDecoration(value: string): string {
  const trimmed = value.trim()

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end !== -1) {
      return trimmed.slice(1, end)
    }
  }

  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(trimmed)
  if (ipv4WithPort) {
    return ipv4WithPort[1]!
  }

  return trimmed
}

function parseAddress(value: string): ParsedAddress | null {
  const cleaned = stripAddressDecoration(value)
  if (!cleaned) {
    return null
  }

  return cleaned.includes(':') ? parseIPv6(cleaned) : parseIPv4(cleaned)
}

function parseIPv4(value: string): ParsedAddress | null {
  const parts = value.split('.')
  if (parts.length !== 4) {
    return null
  }

  const bytes: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null
    }

    const byte = Number(part)
    if (byte > 255) {
      return null
    }

    bytes.push(byte)
  }

  return { family: 4, bytes }
}

function parseIPv6(value: string): ParsedAddress | null {
  // A zone index (`fe80::1%eth0`) identifies an interface, not a different host
  // address for our purposes.
  const zone = value.indexOf('%')
  const input = zone === -1 ? value : value.slice(0, zone)
  if (!input || input.includes(':::')) {
    return null
  }

  const halves = input.split('::')
  if (halves.length > 2) {
    return null
  }

  const left = halves[0] ? parseIPv6Groups(halves[0].split(':')) : []
  if (!left) {
    return null
  }

  let groups: number[]

  if (halves.length === 1) {
    if (left.length !== 8) {
      return null
    }

    groups = left
  } else {
    const right = halves[1] ? parseIPv6Groups(halves[1].split(':')) : []
    if (!right || left.length + right.length >= 8) {
      return null
    }

    const zeros = Array.from({ length: 8 - left.length - right.length }, () => 0)
    groups = [...left, ...zeros, ...right]
  }

  const bytes: number[] = []
  for (const group of groups) {
    bytes.push((group >> 8) & 0xff, group & 0xff)
  }

  // `::ffff:192.0.2.1` is the same host as `192.0.2.1`; compare it as IPv4 so
  // a v4 address in `DEV_GATE_ALLOW` also matches a mapped header.
  if (
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return { family: 4, bytes: bytes.slice(12) }
  }

  return { family: 6, bytes }
}

function parseIPv6Groups(segments: string[]): number[] | null {
  const groups: number[] = []

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    if (!segment) {
      return null
    }

    if (segment.includes('.')) {
      if (index !== segments.length - 1) {
        return null
      }

      const embedded = parseIPv4(segment)
      if (!embedded) {
        return null
      }

      groups.push(
        (embedded.bytes[0]! << 8) | embedded.bytes[1]!,
        (embedded.bytes[2]! << 8) | embedded.bytes[3]!,
      )
      continue
    }

    if (!/^[0-9a-fA-F]{1,4}$/.test(segment)) {
      return null
    }

    groups.push(Number.parseInt(segment, 16))
  }

  return groups
}

function addressesEqual(left: ParsedAddress, right: ParsedAddress): boolean {
  return (
    left.family === right.family &&
    left.bytes.every((byte, index) => byte === right.bytes[index])
  )
}

function matchesPrefix(address: ParsedAddress, network: ParsedAddress, prefix: number): boolean {
  if (address.family !== network.family) {
    return false
  }

  const totalBits = address.bytes.length * 8
  if (prefix < 0 || prefix > totalBits) {
    return false
  }

  const wholeBytes = Math.floor(prefix / 8)
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address.bytes[index] !== network.bytes[index]) {
      return false
    }
  }

  const remainingBits = prefix % 8
  if (remainingBits === 0) {
    return true
  }

  const mask = (0xff << (8 - remainingBits)) & 0xff
  return (
    (address.bytes[wholeBytes]! & mask) === (network.bytes[wholeBytes]! & mask)
  )
}
