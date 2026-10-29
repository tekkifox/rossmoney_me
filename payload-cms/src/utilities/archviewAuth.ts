/**
 * Credentials for server-side ArchView requests.
 *
 * ArchView is its own deployment (`archview.rossmoney.me`) with OAuth enabled,
 * so an anonymous request is rejected with `401`. The CMS only ever calls it
 * from the server — the `/api/architecture` proxy and the architecture page
 * templates — and authenticates with a static key from that deployment's
 * `API_KEYS`.
 *
 * ArchView accepts the `label:key` form so the key stays out of its logs; only
 * the key itself belongs in the `Authorization` header. Both forms are
 * accepted here so the same value can be pasted from the ArchView stack.
 *
 * When no key is configured the header is omitted, which keeps local
 * development against `AUTH_MODE=none` working unchanged.
 */
export const archviewAuthHeaders = (
  value: string | undefined = process.env.ARCHVIEW_API_KEY,
): Record<string, string> => {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return {}
  }

  const separator = raw.indexOf(':')
  const label = separator > 0 ? raw.slice(0, separator).trim() : ''
  const key = separator > 0 ? raw.slice(separator + 1).trim() : ''
  // Mirrors ArchView's own parsing: an entry only counts as "label:key" when
  // both halves are non-empty, otherwise the whole value is the key.
  const bearer = label && key ? key : raw

  return { Authorization: `Bearer ${bearer}` }
}

type ArchviewEnv = {
  ARCHVIEW_API_KEY?: string
  ARCHVIEW_URL?: string
  [key: string]: string | undefined
}

/**
 * Headers for a request to `target`.
 *
 * Page data can name a different ArchView instance (the gameservers page points
 * at its own project's deployment), so the key is only attached when the target
 * is the ArchView deployment this app is configured for. A page-level URL must
 * never receive this deployment's secret.
 */
export const archviewAuthHeadersFor = (
  target: string,
  env: ArchviewEnv = process.env,
): Record<string, string> => {
  const base = typeof env.ARCHVIEW_URL === 'string' ? env.ARCHVIEW_URL.trim() : ''
  if (!base) {
    // Nothing to compare against (local development): the key, when present,
    // belongs to whatever ArchView is being called.
    return archviewAuthHeaders(env.ARCHVIEW_API_KEY)
  }

  try {
    if (new URL(target).origin !== new URL(base).origin) {
      return {}
    }
  } catch {
    return {}
  }

  return archviewAuthHeaders(env.ARCHVIEW_API_KEY)
}
