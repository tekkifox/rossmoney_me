const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Widget action checked against the token's `action` in the siteverify reply. */
export const TURNSTILE_ACTION = 'contact_form'

const DEFAULT_TIMEOUT_MS = 5_000

/** Cloudflare caps the siteverify `response` field at 2048 characters. */
const MAX_TOKEN_LENGTH = 2_048

export const TURNSTILE_MESSAGES = {
  missingToken: 'Please complete the verification challenge before submitting.',
  rejected: 'Verification failed. Please complete the challenge and try again.',
  unavailable: 'Verification is temporarily unavailable. Please try again.',
  misconfigured: 'Form protection is not configured. Please try again later.',
} as const

export type TurnstileVerification =
  | { ok: true; skipped: boolean }
  | { ok: false; message: string }

type Env = Record<string, string | undefined>

type SiteverifyResponse = {
  action?: string
  hostname?: string
  success?: boolean
  'error-codes'?: string[]
}

export type VerifyTurnstileOptions = {
  env?: Env
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * Hostnames a solved challenge may come from. `TURNSTILE_HOSTNAMES` wins when
 * it contains at least one entry; otherwise the hostname of
 * `NEXT_PUBLIC_SERVER_URL` is used, with the matching `www.`/bare variant added
 * so both spellings of the public site pass. Local hosts are never derived.
 */
export const turnstileHostnames = (env: Env = process.env): string[] => {
  const configured = (env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter((hostname) => hostname.length > 0)

  if (configured.length > 0) return [...new Set(configured)]

  const configuredURL = env.NEXT_PUBLIC_SERVER_URL?.trim()
  if (!configuredURL) return []

  let hostname: string
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(configuredURL)
      ? configuredURL
      : `https://${configuredURL}`
    hostname = new URL(withScheme).hostname.toLowerCase()
  } catch {
    return []
  }

  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    return []
  }

  if (hostname.startsWith('www.')) {
    return [hostname, hostname.slice(4)]
  }

  return [hostname, `www.${hostname}`]
}

/**
 * Production must never fall back to "no challenge". Vercel preview deployments
 * are treated like development so a branch preview still renders the form
 * without dashboard keys; everything else with `NODE_ENV=production` is held to
 * the strict path.
 */
export const isTurnstileRequired = (env: Env = process.env): boolean =>
  env.NODE_ENV === 'production' && env.VERCEL_ENV !== 'preview'

let warnedAboutMissingSecret = false
let warnedAboutMissingHostnames = false

const warnAboutMissingSecret = () => {
  if (warnedAboutMissingSecret) return
  warnedAboutMissingSecret = true
  console.warn(
    '[turnstile] TURNSTILE_SECRET_KEY is not set; skipping contact-form verification outside production.',
  )
}

const warnAboutMissingHostnames = () => {
  if (warnedAboutMissingHostnames) return
  warnedAboutMissingHostnames = true
  console.warn(
    '[turnstile] no hostname allowlist configured; skipping the hostname check outside production.',
  )
}

/**
 * Verify a Turnstile token with Cloudflare. The client token is never trusted
 * on its own: the secret stays on the server and every decision comes from the
 * siteverify response.
 *
 * A missing secret is only tolerated outside production (and on Vercel preview
 * deployments). In production it fails closed with a readable error instead of
 * silently accepting submissions.
 */
export const verifyTurnstileToken = async (
  token: string | null | undefined,
  {
    env = process.env,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: VerifyTurnstileOptions = {},
): Promise<TurnstileVerification> => {
  const secret = env.TURNSTILE_SECRET_KEY

  if (!secret) {
    if (!isTurnstileRequired(env)) {
      warnAboutMissingSecret()
      return { ok: true, skipped: true }
    }

    console.error(
      '[turnstile] TURNSTILE_SECRET_KEY is not set in production; refusing the submission instead of skipping verification.',
    )
    return { ok: false, message: TURNSTILE_MESSAGES.misconfigured }
  }

  const responseToken = token?.trim()
  if (!responseToken) return { ok: false, message: TURNSTILE_MESSAGES.missingToken }
  if (responseToken.length > MAX_TOKEN_LENGTH) {
    console.warn(`[turnstile] token is longer than ${MAX_TOKEN_LENGTH} characters.`)
    return { ok: false, message: TURNSTILE_MESSAGES.rejected }
  }

  const allowedHostnames = turnstileHostnames(env)
  if (allowedHostnames.length === 0) {
    if (isTurnstileRequired(env)) {
      console.error(
        '[turnstile] no hostname allowlist could be derived in production; refusing the submission instead of skipping the check.',
      )
      return { ok: false, message: TURNSTILE_MESSAGES.misconfigured }
    }

    warnAboutMissingHostnames()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      body: new URLSearchParams({ secret, response: responseToken }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error(`[turnstile] siteverify returned HTTP ${response.status}.`)
      return { ok: false, message: TURNSTILE_MESSAGES.unavailable }
    }

    const result = (await response.json()) as SiteverifyResponse
    if (result.success !== true) {
      console.warn('[turnstile] token rejected', result['error-codes'] ?? [])
      return { ok: false, message: TURNSTILE_MESSAGES.rejected }
    }

    // A token minted for another widget on this site key must not be reusable
    // for the contact form.
    if (result.action && result.action !== TURNSTILE_ACTION) {
      console.warn(`[turnstile] token action "${result.action}" does not match "${TURNSTILE_ACTION}".`)
      return { ok: false, message: TURNSTILE_MESSAGES.rejected }
    }

    if (allowedHostnames.length > 0) {
      const hostname = result.hostname?.trim().toLowerCase()
      if (!hostname || !allowedHostnames.includes(hostname)) {
        console.warn(
          `[turnstile] token hostname "${hostname ?? '(missing)'}" is not in the allowlist [${allowedHostnames.join(', ')}].`,
        )
        return { ok: false, message: TURNSTILE_MESSAGES.rejected }
      }
    }

    return { ok: true, skipped: false }
  } catch (error) {
    console.error('[turnstile] verification request failed.', error)
    return { ok: false, message: TURNSTILE_MESSAGES.unavailable }
  } finally {
    clearTimeout(timeout)
  }
}
