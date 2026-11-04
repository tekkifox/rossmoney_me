import { OG_INPUT_LIMITS, sanitizeOgParams, sanitizeOgText } from './ogSanitize'

export const SITE_NAME = 'Ross Money - Developer & DevOps Portfolio'

export const DEFAULT_OG_TITLE = SITE_NAME

export const DEFAULT_OG_DESCRIPTION =
  'Ross Money — DevOps-focused developer. Portfolio showcasing projects, infrastructure, and tooling.'

export const OG_IMAGE_ALT = 'Ross Money — DevOps-focused developer portfolio'

export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630

export const OG_IMAGE_PATH = '/api/og'
export const STATIC_OG_IMAGE_PATH = '/og.jpg'

/**
 * The card is a pure function of the query string, so a crawler that sees the
 * same URL can reuse the image for a year. A page edit changes the title or
 * description and therefore the URL, which naturally keys the cache. The
 * shared cache keeps serving the old card while a new one renders.
 */
export const OG_IMAGE_CACHE_CONTROL =
  'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800, immutable'

export type OgContent = {
  title: string
  description: string
}

/**
 * Read only the two parameters the card renders. `sanitizeOgParams` bounds the
 * values by code point and strips control/bidi formatting before anything
 * reaches Satori; `leader` (a Payload parameter) and unknown keys are ignored.
 */
export function resolveOgContent(searchParams: URLSearchParams): OgContent {
  const { params } = sanitizeOgParams(searchParams)

  return {
    title: params.title?.trim() || DEFAULT_OG_TITLE,
    description: params.description?.trim() || DEFAULT_OG_DESCRIPTION,
  }
}

/** Absolute, deterministic URL for a page's generated card. */
export function buildOgImageUrl(siteURL: string, content: OgContent): string {
  const sanitizedTitle = sanitizeOgText(
    content.title.trim() || DEFAULT_OG_TITLE,
    OG_INPUT_LIMITS.title,
  )
  const sanitizedDescription = sanitizeOgText(
    content.description.trim() || DEFAULT_OG_DESCRIPTION,
    OG_INPUT_LIMITS.description,
  )
  const params = new URLSearchParams({
    title: sanitizedTitle || DEFAULT_OG_TITLE,
    description: sanitizedDescription || DEFAULT_OG_DESCRIPTION,
  })

  return `${siteURL.replace(/\/+$/, '')}${OG_IMAGE_PATH}?${params.toString()}`
}

/**
 * Alt text for the generated card. The card's visible headings are the page
 * title and its description, so the title plus the site name describes it
 * without repeating the body copy.
 */
export function ogImageAlt(pageTitle?: string | null): string {
  const title = pageTitle?.trim()

  if (!title || title === SITE_NAME) {
    return OG_IMAGE_ALT
  }

  return `${title} — ${SITE_NAME}`
}
