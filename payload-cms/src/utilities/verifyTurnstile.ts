const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Widget action checked against the token's `action` in the siteverify reply. */
export const TURNSTILE_ACTION = 'contact_form'

const DEFAULT_TIMEOUT_MS = 5_000

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
  success?: boolean
  'error-codes'?: string[]
}

export type VerifyTurnstileOptions = {
  env?: Env
  fetchImpl?: typeof fetch
  timeoutMs?: number
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

const warnAboutMissingSecret = () => {
  if (warnedAboutMissingSecret) return
  warnedAboutMissingSecret = true
  console.warn(
    '[turnstile] TURNSTILE_SECRET_KEY is not set; skipping contact-form verification outside production.',
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

    return { ok: true, skipped: false }
  } catch (error) {
    console.error('[turnstile] verification request failed.', error)
    return { ok: false, message: TURNSTILE_MESSAGES.unavailable }
  } finally {
    clearTimeout(timeout)
  }
}
