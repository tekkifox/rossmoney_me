/**
 * Input limits for Payload's built-in `/api/og` endpoint.
 *
 * The route lives in `@payloadcms/next` and is generated for every Payload app.
 * It slices `title`/`leader` to 100 characters but passes `description` through
 * untouched, then hands all three to `next/og`'s Node `ImageResponse`. Social
 * preview crawlers never need megabyte-sized strings, so the proxy rewrites the
 * query with these caps before the generator sees it.
 *
 * The real fix for the `next/og` advisory is the dependency upgrade; this is
 * defence in depth so the public route cannot be fed oversized input in the
 * meantime.
 */

export const OG_INPUT_LIMITS = {
  title: 100,
  leader: 100,
  description: 200,
} as const

/**
 * Remove C0/C1 control characters and the Unicode bidi/zero-width formatting
 * characters that can be used to visually spoof a rendered card. Whitespace is
 * kept, then outer whitespace is trimmed.
 */
const CONTROL_AND_FORMATTING = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g

export function sanitizeOgText(value: string, maxLength: number): string {
  const cleaned = value.replace(CONTROL_AND_FORMATTING, '').trim()
  // Slice by code point so a multi-byte character is never cut in half.
  return Array.from(cleaned).slice(0, maxLength).join('')
}

export type SanitizedOgParams = {
  title?: string
  leader?: string
  description?: string
}

export type OgSanitizeResult = {
  params: SanitizedOgParams
  changed: boolean
}

/**
 * Return the sanitized values for the three interpolated parameters and
 * whether anything had to change. Unknown parameters are left for the route to
 * ignore.
 */
export function sanitizeOgParams(
  searchParams: URLSearchParams,
  limits: typeof OG_INPUT_LIMITS = OG_INPUT_LIMITS,
): OgSanitizeResult {
  const params: SanitizedOgParams = {}
  let changed = false

  for (const name of ['title', 'leader', 'description'] as const) {
    if (!searchParams.has(name)) {
      continue
    }

    const original = searchParams.get(name) ?? ''
    const sanitized = sanitizeOgText(original, limits[name])
    params[name] = sanitized

    if (sanitized !== original) {
      changed = true
    }
  }

  return { params, changed }
}
