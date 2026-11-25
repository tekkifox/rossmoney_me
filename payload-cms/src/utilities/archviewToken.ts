/**
 * Token exchange for ArchView machine access.
 *
 * This module is the seam between "how the CMS authenticates to ArchView" and
 * "where the token comes from". ArchView only accepts bearer tokens from the
 * identity provider, so today it implements the OAuth 2.0 `client_credentials`
 * grant (RFC 6749 section 4.4) against Auth0. A deployment that needs a
 * different grant can replace `requestClientCredentialsToken` (or this whole
 * module) without touching the cache, origin guard or callers in
 * `archviewAuth.ts`.
 *
 * Every exchange is bounded by `DEFAULT_TOKEN_TIMEOUT_MS` (or the caller's
 * `timeoutMs`), and a timeout is reported as `ArchviewTokenTimeoutError` so a
 * caller can skip the source instead of stalling on a silent identity
 * provider.
 *
 * It deliberately knows nothing about ArchView's URL or the token cache.
 */

export type ClientCredentialsTokenRequest = {
  audience: string
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope: string
  fetchImpl?: typeof fetch
  /**
   * Hard budget for the exchange. Defaults to `DEFAULT_TOKEN_TIMEOUT_MS`; a
   * missing, non-finite or non-positive value also falls back to it, so the
   * request can never be left unbounded.
   */
  timeoutMs?: number
}

export type AccessToken = {
  accessToken: string
  expiresInSeconds: number
}

export class ArchviewTokenError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ArchviewTokenError'
    this.status = status
  }
}

/**
 * The token endpoint accepted the connection but did not answer in time. It is
 * a distinct class so callers such as the host sampler can treat it as a
 * timeout (skip and move on) rather than a generic failure.
 */
export class ArchviewTokenTimeoutError extends ArchviewTokenError {
  constructor(message: string) {
    super(message)
    this.name = 'ArchviewTokenTimeoutError'
  }
}

/**
 * A token exchange hangs like any other request: a stalled identity provider
 * would otherwise hold the caller forever. Ten seconds is far longer than a
 * healthy Auth0 exchange and still short enough to keep a sweep moving.
 */
export const DEFAULT_TOKEN_TIMEOUT_MS = 10_000

const DEFAULT_EXPIRES_IN_SECONDS = 3600

const resolveTimeoutMs = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TOKEN_TIMEOUT_MS
  }
  return value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readExpiresIn = (value: unknown): number => {
  const seconds = typeof value === 'string' ? Number(value) : value
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_EXPIRES_IN_SECONDS
  }
  return seconds
}

/**
 * Exchanges client credentials for an access token.
 *
 * The provider's token endpoint is called with HTTP Basic authentication, as in
 * ArchView's own README example (`curl -u "client:secret" ...`). The `audience`
 * parameter is required by Auth0 to mint a token for the ArchView API. Errors
 * never include the client secret.
 */
export const requestClientCredentialsToken = async ({
  audience,
  tokenUrl,
  clientId,
  clientSecret,
  scope,
  fetchImpl = fetch,
  timeoutMs,
}: ClientCredentialsTokenRequest): Promise<AccessToken> => {
  const body = new URLSearchParams({ grant_type: 'client_credentials' })
  if (audience) {
    body.set('audience', audience)
  }
  if (scope) {
    body.set('scope', scope)
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')
  const budgetMs = resolveTimeoutMs(timeoutMs)
  const signal = AbortSignal.timeout(budgetMs)
  const timeoutError = () =>
    new ArchviewTokenTimeoutError(`ArchView token endpoint did not answer within ${budgetMs}ms`)

  let response: Response
  try {
    response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    // A stalled endpoint surfaces as the abort reason, not as a network error
    // the caller could interpret: say plainly that this was a timeout.
    if (signal.aborted) throw timeoutError()
    throw error
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
    // The signal also covers the body read, so a half-answered response that
    // aborted mid-body is still a timeout rather than a malformed body.
    if (signal.aborted) throw timeoutError()
  }

  if (!response.ok) {
    const errorCode =
      isRecord(payload) && typeof payload.error === 'string' ? payload.error : ''
    const description =
      isRecord(payload) && typeof payload.error_description === 'string'
        ? payload.error_description
        : ''
    const detail = [errorCode, description].filter(Boolean).join(': ')
    throw new ArchviewTokenError(
      `ArchView token endpoint returned ${response.status}${detail ? `: ${detail}` : ''}`,
      response.status,
    )
  }

  if (!isRecord(payload) || typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new ArchviewTokenError('ArchView token endpoint returned no access_token', response.status)
  }

  return {
    accessToken: payload.access_token,
    expiresInSeconds: readExpiresIn(payload.expires_in),
  }
}
