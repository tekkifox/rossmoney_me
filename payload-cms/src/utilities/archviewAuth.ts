/**
 * Credentials for server-side ArchView requests.
 *
 * ArchView is its own deployment (`archview.rossmoney.me`) and accepts no
 * static API keys. The CMS only ever calls it from the server — the
 * `/api/architecture` proxy and the architecture page templates — so it asks
 * Auth0 for a short-lived access token with the OAuth 2.0 `client_credentials`
 * grant (including the Auth0 `audience`) and sends it as a bearer token.
 *
 * The token is cached in memory per process and renewed shortly before it
 * expires. Concurrent callers share one in-flight exchange, and a single `401`
 * from ArchView invalidates the cached token and retries once with a fresh one.
 *
 * When no client credentials are configured the `Authorization` header is
 * omitted, which keeps local development against `AUTH_MODE=none` working
 * unchanged.
 */

import { requestClientCredentialsToken } from './archviewToken'

export type ArchviewEnv = {
  ARCHVIEW_AUDIENCE?: string
  ARCHVIEW_CLIENT_ID?: string
  ARCHVIEW_CLIENT_SECRET?: string
  ARCHVIEW_SCOPE?: string
  ARCHVIEW_TOKEN_URL?: string
  ARCHVIEW_URL?: string
  [key: string]: string | undefined
}

<<<<<<< HEAD
=======
/**
 * Credentials for one extra ArchView instance, normally a row in the
 * `archview-sources` collection. The origin is part of the identity: a token
 * minted for this instance is only ever sent back to it.
 */
export type ArchviewSourceCredentials = {
  audience: string
  clientId: string
  clientSecret: string
  origin: string
  scope: string
  tokenUrl: string
}

>>>>>>> origin/main
type ArchviewCredentials = {
  audience: string
  clientId: string
  clientSecret: string
  scope: string
  tokenUrl: string
}

type CachedToken = {
  accessToken: string
  refreshAt: number
}

type CacheEntry = {
  inFlight?: Promise<string>
  token?: CachedToken
}

// Refresh at most a minute early, or after 90% of the token's lifetime for
// providers that issue very short-lived tokens.
const MAX_RENEWAL_SKEW_MS = 60_000
const DEFAULT_SCOPE = 'archview:read'
const DEFAULT_AUDIENCE = 'https://archview.rossmoney.me/api'

const tokenCache = new Map<string, CacheEntry>()

export class ArchviewAuthConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchviewAuthConfigError'
  }
}

const readString = (value: string | undefined): string =>
  typeof value === 'string' ? value.trim() : ''

const readCredentials = (env: ArchviewEnv): ArchviewCredentials | null => {
  const clientId = readString(env.ARCHVIEW_CLIENT_ID)
  const clientSecret = readString(env.ARCHVIEW_CLIENT_SECRET)

  if (!clientId && !clientSecret) {
    return null
  }
  if (!clientId || !clientSecret) {
    throw new ArchviewAuthConfigError(
      'ARCHVIEW_CLIENT_ID and ARCHVIEW_CLIENT_SECRET must be set together',
    )
  }

  const tokenUrl = readString(env.ARCHVIEW_TOKEN_URL)
  if (!tokenUrl) {
    throw new ArchviewAuthConfigError(
      'ARCHVIEW_TOKEN_URL is required when ARCHVIEW_CLIENT_ID is set',
    )
  }
  try {
    new URL(tokenUrl)
  } catch {
    throw new ArchviewAuthConfigError('ARCHVIEW_TOKEN_URL must be an absolute URL')
  }

  return {
    audience: readString(env.ARCHVIEW_AUDIENCE) || DEFAULT_AUDIENCE,
    clientId,
    clientSecret,
    scope: readString(env.ARCHVIEW_SCOPE) || DEFAULT_SCOPE,
    tokenUrl,
  }
}

const cacheKey = (credentials: ArchviewCredentials): string =>
  `${credentials.tokenUrl}\n${credentials.clientId}\n${credentials.audience}\n${credentials.scope}`

const getCachedToken = async (
  credentials: ArchviewCredentials,
  fetchImpl: typeof fetch,
<<<<<<< HEAD
): Promise<string> => {
  const key = cacheKey(credentials)
=======
  cacheKeyOverride?: string,
): Promise<string> => {
  const key = cacheKeyOverride ?? cacheKey(credentials)
>>>>>>> origin/main
  let entry = tokenCache.get(key)
  if (!entry) {
    entry = {}
    tokenCache.set(key, entry)
  }

  // A token that is still comfortably valid is reused without a round trip.
  if (entry.token && Date.now() < entry.token.refreshAt) {
    return entry.token.accessToken
  }

  // Every caller that arrives while the exchange is running awaits that same
  // request instead of starting another one.
  if (!entry.inFlight) {
    entry.inFlight = requestClientCredentialsToken({
      audience: credentials.audience,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      scope: credentials.scope,
      tokenUrl: credentials.tokenUrl,
      fetchImpl,
    })
      .then(({ accessToken, expiresInSeconds }) => {
        const lifetimeMs = Math.max(0, expiresInSeconds * 1000)
        const renewalSkewMs = Math.min(MAX_RENEWAL_SKEW_MS, lifetimeMs / 10)
        entry.token = { accessToken, refreshAt: Date.now() + lifetimeMs - renewalSkewMs }
        return accessToken
      })
      .finally(() => {
        entry.inFlight = undefined
      })
  }

  return entry.inFlight
}

<<<<<<< HEAD
=======
const isSameOrigin = (target: string, origin: string): boolean => {
  try {
    return new URL(target).origin === new URL(origin).origin
  } catch {
    return false
  }
}

>>>>>>> origin/main
const isConfiguredTarget = (target: string, env: ArchviewEnv): boolean => {
  const base = readString(env.ARCHVIEW_URL)
  // No configured deployment means no origin this credential belongs to. A
  // page-level `archviewUrl` must never receive the CMS's identity.
  if (!base) {
    return false
  }

<<<<<<< HEAD
  try {
    return new URL(target).origin === new URL(base).origin
  } catch {
    return false
  }
=======
  return isSameOrigin(target, base)
>>>>>>> origin/main
}

/**
 * Headers for a request to `target`.
 *
 * Page data can name a different ArchView instance (the gameservers page points
 * at its own project's deployment), so the token is only attached when the
 * target is the ArchView deployment this app is configured for. A page-level
 * URL must never receive this deployment's token.
 */
export const archviewAuthHeadersFor = async (
  target: string,
  env: ArchviewEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> => {
  if (!isConfiguredTarget(target, env)) {
    return {}
  }

  const credentials = readCredentials(env)
  if (!credentials) {
    return {}
  }

  return { Authorization: `Bearer ${await getCachedToken(credentials, fetchImpl)}` }
}

/**
 * Drops cached tokens, mainly for tests and for an explicit credential
 * rotation. The next request exchanges the credentials again.
 */
export const clearArchviewTokenCache = (): void => {
  tokenCache.clear()
}

const invalidateToken = (env: ArchviewEnv): void => {
  let credentials: ArchviewCredentials | null = null
  try {
    credentials = readCredentials(env)
  } catch {
    return
  }
  if (credentials) {
    tokenCache.delete(cacheKey(credentials))
  }
}

const withHeaders = (init: RequestInit, extra: Record<string, string>): RequestInit => {
  const headers = new Headers(init.headers)
  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value)
  }
  return { ...init, headers }
}

<<<<<<< HEAD
/**
 * `fetch` for ArchView with the machine token attached. A `401` retries once
 * with a freshly exchanged token, which covers rotation and early revocation.
 * Requests to any other origin are sent without credentials.
 */
export const archviewFetch = async (
  target: string,
  init: RequestInit = {},
  env: ArchviewEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  const headers = await archviewAuthHeadersFor(target, env, fetchImpl)
=======
type MachineAuth = {
  headers: () => Promise<Record<string, string>>
  invalidate: () => void
}

/**
 * Attaches the headers from `auth` and retries once after a `401` with a fresh
 * token, which covers rotation and early revocation. Requests with no
 * credential are passed through untouched.
 */
const fetchWithRefresh = async (
  target: string,
  init: RequestInit,
  auth: MachineAuth,
  fetchImpl: typeof fetch,
): Promise<Response> => {
  const headers = await auth.headers()
>>>>>>> origin/main
  const response = await fetchImpl(target, withHeaders(init, headers))

  if (response.status !== 401 || !headers.Authorization) {
    return response
  }

<<<<<<< HEAD
  invalidateToken(env)
  const retryHeaders = await archviewAuthHeadersFor(target, env, fetchImpl)
=======
  auth.invalidate()
  const retryHeaders = await auth.headers()
>>>>>>> origin/main
  if (!retryHeaders.Authorization) {
    return response
  }

  // Release the rejected response before opening the retry.
  try {
    await response.body?.cancel()
  } catch {
    // The body may already be unusable; the retry does not depend on it.
  }

  return fetchImpl(target, withHeaders(init, retryHeaders))
}
<<<<<<< HEAD
=======

/**
 * `fetch` for ArchView with the machine token attached. A `401` retries once
 * with a freshly exchanged token, which covers rotation and early revocation.
 * Requests to any other origin are sent without credentials.
 */
export const archviewFetch = async (
  target: string,
  init: RequestInit = {},
  env: ArchviewEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  const auth: MachineAuth = {
    headers: () => archviewAuthHeadersFor(target, env, fetchImpl),
    invalidate: () => invalidateToken(env),
  }
  return fetchWithRefresh(target, init, auth, fetchImpl)
}

const sourceCredentials = (source: ArchviewSourceCredentials): ArchviewCredentials => ({
  audience: readString(source.audience),
  clientId: readString(source.clientId),
  clientSecret: source.clientSecret,
  scope: readString(source.scope) || DEFAULT_SCOPE,
  tokenUrl: readString(source.tokenUrl),
})

/**
 * The cache key is the source itself. Two instances never share a token, even
 * when they happen to use the same identity provider and client.
 */
const sourceCacheKey = (source: ArchviewSourceCredentials): string =>
  `source:${source.origin}\n${readString(source.tokenUrl)}\n${readString(source.clientId)}\n${readString(source.audience)}\n${readString(source.scope) || DEFAULT_SCOPE}`

/**
 * Headers for a request to one source's own origin. Like `archviewFetch`, a
 * token for one instance is never attached to a different origin.
 */
export const archviewSourceAuthHeadersFor = async (
  target: string,
  source: ArchviewSourceCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> => {
  if (!isSameOrigin(target, source.origin)) {
    return {}
  }

  return {
    Authorization: `Bearer ${await getCachedToken(
      sourceCredentials(source),
      fetchImpl,
      sourceCacheKey(source),
    )}`,
  }
}

/**
 * `fetch` for one extra ArchView instance, with that instance's token. The
 * retry behaviour and per-source cache match the configured deployment, but
 * the token is only ever sent to `source.origin`.
 */
export const archviewSourceFetch = async (
  target: string,
  init: RequestInit,
  source: ArchviewSourceCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  const auth: MachineAuth = {
    headers: () => archviewSourceAuthHeadersFor(target, source, fetchImpl),
    invalidate: () => {
      tokenCache.delete(sourceCacheKey(source))
    },
  }
  return fetchWithRefresh(target, init, auth, fetchImpl)
}

>>>>>>> origin/main
