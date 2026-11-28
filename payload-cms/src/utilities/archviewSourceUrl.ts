/**
 * The one rule for an ArchView instance URL: the source `origin` on
 * `archview-sources`, and the legacy per-page `archviewUrl`.
 *
 * A public instance must be https. The single exception is a Tailscale
 * MagicDNS name (`*.ts.net`): that host is reachable only inside the tailnet,
 * where WireGuard already encrypts the traffic, so plain http is not exposed on
 * the network. The suffix has to be a whole label, so a lookalike such as
 * `example.ts.net.evil.com` is still refused.
 *
 * `tokenUrl` deliberately does not use this rule: the identity provider is a
 * public https endpoint, so it stays https-only.
 */
const TAILNET_HOST_SUFFIX = '.ts.net'

/** A hostname ending in `.ts.net`, for example `deploy-seat.tail81cbd2.ts.net`. */
export const isTailnetHostname = (hostname: string): boolean => {
  const value = hostname.toLowerCase()
  return value.length > TAILNET_HOST_SUFFIX.length && value.endsWith(TAILNET_HOST_SUFFIX)
}

/** https anywhere, or http only to a `*.ts.net` host. */
const isAllowedSourceProtocol = (url: URL): boolean =>
  url.protocol === 'https:' ||
  (url.protocol === 'http:' && isTailnetHostname(url.hostname))

export type ArchviewSourceUrlOptions = {
  /** Noun used in messages, for example "origin" or "ArchView URL". */
  noun?: string
  /** Whether a blank value is refused. Defaults to true. */
  required?: boolean
}

export const validateArchviewSourceUrl = (
  value: unknown,
  { noun = 'origin', required = true }: ArchviewSourceUrlOptions = {},
): string | true => {
  if (typeof value !== 'string' || !value.trim()) {
    return required ? `The ${noun} is required` : true
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Enter an absolute https:// URL, for example https://archview.example.com'
  }

  if (!isAllowedSourceProtocol(url)) {
    return `The ${noun} must use https://, except for a Tailscale host ending in .ts.net`
  }
  if (url.username || url.password) {
    return `The ${noun} must not contain credentials`
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return 'Enter the origin only, without a path, query or fragment'
  }

  return true
}
