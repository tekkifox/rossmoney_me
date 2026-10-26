import { getServerSideURL } from './getURL'

/**
 * Payload's cookie strategy (`extractJWT`) only accepts a session cookie when
 * the request's `Origin` header is listed in `config.csrf`; otherwise it drops
 * the cookie and every admin mutation comes back as
 * `UnauthorizedError: you must be logged in to make this request`.
 *
 * `payload.config.ts` builds that list from the origin it knows statically
 * (`getServerSideURL()`) plus `serverURL` when one is configured. On Vercel a
 * deployment is additionally served from domains the build cannot name — a
 * preview alias, a branch alias or a custom domain such as `dev.rossmoney.me` —
 * so those requests log in but cannot write, and the admin appears to hang.
 *
 * A request whose `Origin` matches the host it was sent to is same-origin and
 * cannot be a cross-site request forgery, so it is safe to let it through
 * unauthenticated by the allowlist. The proxy drops the header for exactly that
 * case; cross-origin requests keep their `Origin` and stay subject to the
 * allowlist. Origins that are already allowlisted keep their header too, so
 * configured deployments behave exactly as before.
 *
 * @see https://payloadcms.com/docs/authentication/overview#csrf-protection
 */

type OriginRequest = {
  /** Raw `Origin` request header. */
  origin: string | null
  /** Request host, normally `x-forwarded-host` or `host`. */
  host: string | null
  /** `https` or `http`, normally from `x-forwarded-proto`. */
  protocol: string
}

const toProtocol = (value: string): string => value.replace(/:$/, '').toLowerCase()

/**
 * Canonical form of an origin so `https://example.com/` and
 * `https://example.com` compare equal. Returns `null` for anything that is not
 * a parseable absolute URL.
 */
export const normaliseOrigin = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/** Origins Payload's CSRF allowlist accepts for this deployment. */
export const trustedOrigins = (
  env: Record<string, string | undefined> = process.env,
): string[] => {
  const configured = [env.SERVER_URL, env.NEXT_PUBLIC_SERVER_URL, getServerSideURL()]
  const origins = configured
    .map((value) => normaliseOrigin(value))
    .filter((value): value is string => Boolean(value))

  return [...new Set(origins)]
}

export const isSameOriginRequest = ({ origin, host, protocol }: OriginRequest): boolean => {
  const normalised = normaliseOrigin(origin)
  if (!normalised || !host) {
    return false
  }

  // `normaliseOrigin` already proved this parses.
  const parsed = new URL(normalised)

  return parsed.host === host && parsed.protocol === `${toProtocol(protocol)}:`
}

/**
 * Whether the proxy should remove the `Origin` header before Payload reads it.
 *
 * Only ever true for a same-origin request whose origin is *not* already
 * allowlisted — the case a static `csrf` list cannot cover.
 */
export const shouldDropOriginHeader = (
  request: OriginRequest,
  trusted: string[] = trustedOrigins(),
): boolean => {
  const origin = normaliseOrigin(request.origin)
  const configured = trusted
    .map((value) => normaliseOrigin(value))
    .filter((value): value is string => Boolean(value))

  if (!origin || configured.includes(origin)) {
    return false
  }

  return isSameOriginRequest({ ...request, origin })
}
