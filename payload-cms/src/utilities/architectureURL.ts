/**
 * The architecture API URL that is safe to put in page data.
 *
 * ArchView is authenticated, so the browser has no session and cannot call it
 * directly: a request to the public ArchView origin would come back `401` with
 * no CORS headers. Every page therefore points at this app's same-origin
 * `/api/architecture` proxy, which carries the machine credential server-side
 * and reaches the configured ArchView deployment.
 *
<<<<<<< HEAD
 * A page may still name its own ArchView instance (the game-servers page points
 * at a different project's deployment). When that value is an absolute HTTPS
 * origin other than this deployment's `ARCHVIEW_URL`, the proxy path carries it
 * as a `source` query parameter. The proxy only honours allowlisted origins.
=======
 * A page chooses an ArchView instance through its relation, legacy URL text or
 * the collection's default row. When that value is a public HTTPS origin, the
 * proxy path carries it as a `source` query parameter. `forceSource` keeps the
 * parameter even when the origin matches `ARCHVIEW_URL`, so the proxy resolves
 * the exact row the page chose.
>>>>>>> origin/main
 *
 * Internal Docker names, loopback addresses, bare hosts and unset values all
 * fall back to the plain proxy path.
 */
type ArchitectureEnv = {
  ARCHVIEW_URL?: string | null
  [key: string]: string | null | undefined
}

<<<<<<< HEAD
=======
export type BrowserArchitectureApiOptions = {
  /**
   * Include `?source=` even when the origin is `ARCHVIEW_URL`. Used for a
   * source chosen by relation or as the collection default, where the proxy
   * must resolve that specific row rather than whatever the environment names.
   */
  forceSource?: boolean
}

>>>>>>> origin/main
const PROXY_PATH = '/api/architecture'

const normalizeURL = (value?: string | null): URL | null => {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (!candidate) {
    return null
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`

  try {
    return new URL(withScheme)
  } catch {
    return null
  }
}

// Public DNS names only. A single-label Docker service name, localhost or an
// IPv4 literal is a server-side address, not a browser destination.
const isPublicHost = (url: URL): boolean =>
  url.protocol === 'https:' &&
  url.hostname.includes('.') &&
  url.hostname !== 'localhost' &&
  !url.hostname.endsWith('.localhost') &&
  !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)

export const browserArchitectureApi = (
  value?: string | null,
  env: ArchitectureEnv = process.env,
<<<<<<< HEAD
=======
  options: BrowserArchitectureApiOptions = {},
>>>>>>> origin/main
): string => {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (!candidate) {
    return PROXY_PATH
  }

  // Only an explicitly absolute HTTPS URL can name another instance. A bare
  // host is ambiguous and could be an internal service name.
  if (!/^https:\/\//i.test(candidate)) {
    return PROXY_PATH
  }

  const url = normalizeURL(candidate)
  if (!url || !isPublicHost(url)) {
    return PROXY_PATH
  }

  const own = normalizeURL(env.ARCHVIEW_URL)
<<<<<<< HEAD
  if (own && own.origin === url.origin) {
=======
  if (!options.forceSource && own && own.origin === url.origin) {
>>>>>>> origin/main
    return PROXY_PATH
  }

  return `${PROXY_PATH}?source=${encodeURIComponent(url.origin)}`
}
