/**
 * The one public origin used for canonical URLs, Open Graph URLs, the sitemap
 * and structured data.
 *
 * This is deliberately separate from `getServerSideURL()`: that helper also
 * feeds Payload's admin CSRF allowlist and media URLs, so on Vercel it is left
 * unset on purpose (see `serverURL.ts`). Social and search metadata has the
 * opposite requirement: it must always name the public site, on every
 * deployment, or three hosts end up advertising three different canonical URLs.
 *
 * Precedence:
 *  1. `SERVER_URL` (the Portainer deployment pins this)
 *  2. `NEXT_PUBLIC_SERVER_URL` (the Payload default, inlined at build time)
 *  3. the public production origin below.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is intentionally never used: it is a bare
 * hostname, which produced scheme-less sitemap `<loc>` values and pointed
 * sharing metadata at a deployment instead of the browsable domain.
 */
export const DEFAULT_SITE_URL = 'https://www.rossmoney.me'

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, '')

/**
 * Accept either a full origin (`https://www.example.com`) or a bare host
 * (`www.example.com`) and return a scheme-qualified origin without a trailing
 * slash. An unparseable value is treated as a host, which is the shape Vercel
 * publishes.
 */
const normaliseSiteURL = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).origin
  } catch {
    return `https://${stripTrailingSlashes(trimmed)}`
  }
}

export const getSiteURL = (env: Record<string, string | undefined> = process.env): string => {
  return (
    normaliseSiteURL(env.SERVER_URL) ||
    normaliseSiteURL(env.NEXT_PUBLIC_SERVER_URL) ||
    DEFAULT_SITE_URL
  )
}

/** Host form of {@link getSiteURL}, used to compare an incoming request host. */
export const getSiteHost = (env: Record<string, string | undefined> = process.env): string => {
  return new URL(getSiteURL(env)).host.toLowerCase()
}

/**
 * Reduce a `Host` / `X-Forwarded-Host` value to its hostname (no port, lower
 * case). A forwarded header can carry a comma-separated chain; the first entry
 * is the one the browser requested.
 */
export const requestHostname = (value: string | null | undefined): string | null => {
  const first = value?.split(',')[0]?.trim()
  if (!first) return null

  const withoutPort = first.replace(/:\d+$/, '')
  return withoutPort ? withoutPort.toLowerCase() : null
}

/**
 * True when a request arrived on the canonical public host.
 *
 * Unknown hosts (no header at all, as in some unit tests) are treated as
 * canonical so a missing header cannot accidentally emit a noindex.
 */
export const isCanonicalHost = (
  host: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean => {
  const hostname = requestHostname(host)
  if (!hostname) return true

  return hostname === getSiteHost(env)
}

/**
 * `X-Robots-Tag` value for a request host, or `null` when the host is the
 * canonical public origin and should stay indexable.
 */
export const getRobotsTag = (
  host: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null => (isCanonicalHost(host, env) ? null : 'noindex, nofollow')
