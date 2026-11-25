import { revalidatePath } from 'next/cache'

/**
 * Revalidation window for prerendered public HTML.
 *
 * Keep the literal `export const revalidate = 300` in
 * `app/(frontend)/[slug]/page.tsx` in step with this value: Next.js requires the
 * route-segment export to be statically analysable, so it cannot import the
 * constant itself.
 */
export const PUBLIC_PAGE_REVALIDATE_SECONDS = 300

/** Ignore a mutation that happens outside a Next.js cache context. */
const attempt = (fn: () => void): void => {
  try {
    fn()
  } catch {
    // Seeding, CLI scripts and unit tests have no request/cache context.
  }
}

/**
 * Public path(s) a page slug is served at.
 *
 * The homepage document stores the slug `home`, so it is cached under the
 * `[slug]` route as `/home`; `next.config.ts` rewrites `/` to that path. Both
 * keys are revalidated because the rewrite source is what visitors request.
 */
export const publicPagePaths = (slug?: string | null): string[] => {
  const cleaned = slug?.trim().replace(/^\/+|\/+$/g, '')
  if (!cleaned || cleaned === 'home') {
    return ['/', '/home']
  }

  return [`/${cleaned}`]
}

/** Invalidate one public page after a content change. */
export const revalidatePublicPage = (slug?: string | null): void => {
  for (const path of publicPagePaths(slug)) {
    attempt(() => revalidatePath(path))
  }
}

/**
 * Invalidate the root layout and every public page beneath it.
 *
 * Header, footer and ArchView source changes are rendered into every page, and
 * the set of published slugs lives in the database, so a per-path loop would
 * need a query the hooks cannot always run. Revalidating the layout is the
 * documented way to clear the whole public route cache.
 */
export const revalidateAllPublicPages = (): void => {
  attempt(() => revalidatePath('/', 'layout'))
}
