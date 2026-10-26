/**
 * Origin Payload treats as its own.
 *
 * `serverURL` is not just a base for links: Payload also uses it as the admin's
 * API base URL, to absolutise media `url` / `thumbnailURL`, to build
 * password-reset links and to extend the CSRF allowlist. It therefore has to be
 * the origin a person actually browses.
 *
 * Explicit configuration always wins, so the Portainer stack
 * (`SERVER_URL=https://www.rossmoney.me/`) and local development stay pinned to
 * the public origin they serve.
 *
 * On Vercel no environment variable names that origin. `VERCEL_URL` is the
 * current deployment's own hostname, which is not the domain in the browser
 * (`dev.rossmoney.me`, `rossmoney-me.vercel.app`) and is normally behind
 * Deployment Protection. Using it made the admin send same-site requests to a
 * foreign, unauthenticated host and made every media URL point at a deployment
 * that disappears on the next deploy. The value is therefore left empty, which
 * tells Payload to keep the admin on the origin it was served from and to keep
 * media URLs relative (the storage adapter's intended design).
 *
 * @see https://vercel.com/docs/environment-variables/system-environment-variables
 */
const LOCAL_SERVER_URL = 'http://localhost:8082'

/**
 * Variables Vercel sets for every deployment. Any one of them means "this
 * process runs on Vercel", where a localhost fallback would be wrong.
 */
const vercelMarkers = ['VERCEL', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const

export const isVercelRuntime = (
  env: Record<string, string | undefined> = process.env,
): boolean => vercelMarkers.some((name) => Boolean(env[name]))

export const resolveServerURL = (
  env: Record<string, string | undefined> = process.env,
): string => {
  const configured = env.SERVER_URL || env.NEXT_PUBLIC_SERVER_URL
  if (configured) {
    return configured
  }

  // Deliberately unset, not "some Vercel hostname" and not localhost: Payload
  // must neither absolutise URLs to a deployment nor keep a localhost default.
  if (isVercelRuntime(env)) {
    return ''
  }

  return LOCAL_SERVER_URL
}
