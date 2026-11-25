import type { Metadata } from 'next'

import { getSafePayload } from '@/utilities/getSafePayload'
import { generatePageMetadata, renderPage } from './render'

/**
 * Public pages are prerendered and revalidated on a timer; content changes
 * invalidate them immediately from the Payload hooks
 * (see `utilities/revalidatePublicPages.ts`). The draft-mode cookie never
 * reaches this route: `proxy.ts` rewrites draft requests to the dynamic
 * preview renderer under `next/draft/`, so this file must not read
 * `draftMode()` or any other request-time API.
 *
 * Keep the literal in step with `PUBLIC_PAGE_REVALIDATE_SECONDS`; Next.js
 * requires a statically analysable value here. A nested `unstable_cache` with a
 * shorter window (the architecture snapshot at 45 s, a global at 60 s) lowers
 * the effective `s-maxage` below this ceiling.
 */
export const revalidate = 300

export async function generateStaticParams() {
  try {
    const payload = await getSafePayload()
    const pages = await payload.find({
      collection: 'pages',
      draft: false,
      limit: 1000,
      overrideAccess: false,
      pagination: false,
      select: {
        slug: true,
      },
    })

    const params = pages.docs
      ?.filter((doc: { slug?: string | null }) => {
        return doc.slug !== 'home'
      })
      .map(({ slug }: { slug: string }) => {
        return { slug }
      })

    return params
  } catch {
    return []
  }
}

type Args = {
  params: Promise<{
    slug?: string
  }>
}

export default async function Page({ params: paramsPromise }: Args) {
  const { slug = 'home' } = await paramsPromise

  return renderPage({ slug, draft: false, track: true })
}

export async function generateMetadata({ params: paramsPromise }: Args): Promise<Metadata> {
  const { slug = 'home' } = await paramsPromise

  return generatePageMetadata({ slug, draft: false })
}
