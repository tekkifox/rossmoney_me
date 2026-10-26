/**
 * The architecture API URL that is safe to put in page data.
 *
 * `ArchView` is normally reached server-side, and on the Portainer stack its
 * address is an internal Docker name (`http://archview:8080`). Rendering that
 * value into `data-architecture-api` / the `architecture-api` meta tag leaks an
 * internal host into the HTML, and the browser cannot reach it anyway: the CSP
 * only allows public HTTPS ArchView origins in `connect-src`.
 *
 * A configured value is only useful to the browser when it is a public HTTPS
 * origin. Everything else falls back to this app's same-origin
 * `/api/architecture` proxy, which reaches the internal service server-side and
 * redacts the snapshot before returning it.
 */
export const browserArchitectureApi = (value?: string | null): string => {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (!candidate) {
    return '/api/architecture'
  }

  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`

  try {
    const url = new URL(withScheme)
    const host = url.hostname

    // Public DNS names only. A single-label Docker service name, localhost or
    // an IPv4 literal is a server-side address, not a browser destination.
    const isPublicHost = url.protocol === 'https:' && host.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(host)
    return isPublicHost ? `${url.origin}/api/architecture` : '/api/architecture'
  } catch {
    return '/api/architecture'
  }
}
