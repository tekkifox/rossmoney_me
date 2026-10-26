/**
 * Absolute origin Payload uses to build URLs it generates itself, such as media
 * URLs and password-reset links.
 *
 * Explicit configuration always wins so the Portainer stack and local
 * development can pin the public origin. Vercel's variables are hostnames
 * without a scheme, so `https://` is added explicitly; `VERCEL_URL` names the
 * current deployment and therefore keeps previews pointing at themselves,
 * while the production alias is only a fallback.
 *
 * @see https://vercel.com/docs/environment-variables/system-environment-variables
 */
const LOCAL_SERVER_URL = 'http://localhost:8082'

const vercelHosts = ['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const

export const resolveServerURL = (
  env: Record<string, string | undefined> = process.env,
): string => {
  const configured = env.SERVER_URL || env.NEXT_PUBLIC_SERVER_URL
  if (configured) {
    return configured
  }

  for (const name of vercelHosts) {
    const host = env[name]
    if (host) {
      return `https://${host}`
    }
  }

  return LOCAL_SERVER_URL
}
