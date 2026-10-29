// ArchView returns the public endpoints it exposes alongside its snapshot:
//
//   "endpoints": [{ "name": "overview", "url": "https://archview.../api/overview" }]
//
// The payload comes from an external service, so every field is treated as
// unknown until validated here. Only `http:`/`https:` URLs survive; the client
// renders the result with DOM APIs (never HTML), so this is the one gate that
// keeps `javascript:` and friends out of an href.

import { asRecord } from '@/utilities/json'

export interface ArchitectureEndpoint {
  name: string
  url: string
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/** True when `value` parses as an absolute http(s) URL. */
function isHttpUrl(value: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * Extracts the `endpoints` array from an ArchView payload.
 *
 * Missing, malformed or empty input yields `[]`, which callers treat as "hide
 * the section". Entries without a usable name or URL are skipped rather than
 * rendered with a placeholder.
 */
export function parseArchitectureEndpoints(payload: unknown): ArchitectureEndpoint[] {
  const raw = asRecord(payload).endpoints
  if (!Array.isArray(raw)) return []

  const endpoints: ArchitectureEndpoint[] = []
  for (const entry of raw) {
    const record = asRecord(entry)
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!name || !url || !isHttpUrl(url)) continue
    endpoints.push({ name, url })
  }
  return endpoints
}
