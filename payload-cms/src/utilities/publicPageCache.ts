/**
 * How public pages are cached, and how a draft/preview request is routed away
 * from that cache.
 *
 * Public HTML is prerendered with a revalidation window (see the
 * `export const revalidate` in `app/(frontend)/[slug]/page.tsx`). Next.js marks
 * such a response `s-maxage=…, stale-while-revalidate=…` and a CDN may store it,
 * so the page must not read request-time state such as `draftMode()` — doing so
 * would force the whole route dynamic and bring back `private, no-store`.
 *
 * Draft mode is therefore handled by `proxy.ts`: when the draft cookie is
 * present the request is rewritten to the dynamic preview route under
 * `app/(frontend)/next/draft/`, which does read `draftMode()` and renders the
 * draft document. Normal visitors never reach that route, and the preview route
 * is never cached.
 */

/**
 * Next.js' own draft-mode cookie. `draftMode()` sets it to the build's preview
 * id; its presence is what tells the proxy to route a request to the dynamic
 * preview renderer.
 */
export const DRAFT_MODE_COOKIE = '__prerender_bypass'

/**
 * Non-httpOnly companion cookie set by `/next/preview` and cleared by
 * `/next/exit-preview`. The admin bar is a client component in an otherwise
 * static layout, so this cookie is how it learns that "Exit preview mode"
 * should be offered. It has no authority of its own: the draft cookie above is
 * what `draftMode()` validates.
 */
export const PREVIEW_MODE_COOKIE = 'preview-mode'

/** Route that renders draft content (dynamic, never cached). */
export const DRAFT_RENDER_PREFIX = '/next/draft'

/**
 * Top-level paths that are not public page documents even though they look like
 * a single dynamic segment. They must never be rewritten to the preview route.
 */
const RESERVED_PREFIXES = [
  '/admin',
  '/api',
  '/next',
  '/_next',
  '/_vercel',
  '/vercel',
  // Ackee tracker, served first-party under `/a`.
  '/a',
] as const

const stripTrailingSlashes = (pathname: string): string =>
  pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

/**
 * True for a URL that the public `[slug]` route (or the homepage rewrite) can
 * render: `/` or exactly one path segment with no extension.
 *
 * Being conservative matters: the proxy only rewrites in draft mode, and
 * rewriting an asset such as `/favicon.svg` or `/site.webmanifest` to the page
 * renderer would break the preview frame.
 */
export const isPublicPagePath = (pathname: string): boolean => {
  if (!pathname.startsWith('/')) return false

  const normalised = stripTrailingSlashes(pathname)
  if (normalised === '/') return true

  const segment = normalised.slice(1)
  if (segment === '' || segment.includes('/') || segment.includes('.')) return false

  return !RESERVED_PREFIXES.some(
    (prefix) => normalised === prefix || normalised.startsWith(`${prefix}/`),
  )
}

export type PublicRequestPlan =
  | { mode: 'public' }
  | { mode: 'preview'; destination: string }
  | { mode: 'other' }

/**
 * Decide what a request needs:
 *
 * - `public`  – an ordinary visitor: serve the revalidated, cacheable route.
 * - `preview` – draft mode is on: rewrite to the dynamic draft renderer.
 * - `other`   – admin, API, Next internals, static files: leave the URL alone.
 *
 * Pure so the gate can be unit-tested without a Next.js request context.
 */
export const planPublicRequest = ({
  pathname,
  draftMode,
}: {
  pathname: string
  draftMode: boolean
}): PublicRequestPlan => {
  if (!isPublicPagePath(pathname)) {
    return { mode: 'other' }
  }

  if (!draftMode) {
    return { mode: 'public' }
  }

  const normalised = stripTrailingSlashes(pathname)
  return {
    mode: 'preview',
    destination:
      normalised === '/' ? DRAFT_RENDER_PREFIX : `${DRAFT_RENDER_PREFIX}${normalised}`,
  }
}
