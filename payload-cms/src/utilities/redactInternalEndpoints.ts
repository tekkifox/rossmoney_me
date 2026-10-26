/**
 * The ArchView service reports its Docker endpoint as
 * `http://socket-proxy:2375`. That value is useful on the server but must never
 * reach the browser: it names an internal container and port that are not
 * routable from the internet.
 *
 * ArchView is an external service we do not control, and the page renders its
 * snapshot verbatim (including the "Raw snapshot" panel and the RSC payload), so
 * the CMS redacts single-label hosts from the payload before rendering or
 * proxying it. Public hosts (`archview.vortexservers.co.uk`, registry names,
 * etc.) keep their dots and are left alone.
 */

const HTTP_URL = /\bhttps?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>\\]*)?/gi

const isInternalHost = (hostname: string): boolean => {
  // A Docker service name has no dot. IPv4 literals and public DNS names do.
  return !hostname.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname)
}

export function redactInternalEndpoints<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(HTTP_URL, (match) => {
      try {
        return isInternalHost(new URL(match).hostname) ? '[internal]' : match
      } catch {
        return match
      }
    }) as T
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactInternalEndpoints(entry)) as T
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactInternalEndpoints(entry)
    }
    return result as T
  }

  return value
}
