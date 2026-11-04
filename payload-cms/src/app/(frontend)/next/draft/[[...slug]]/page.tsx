import type { Metadata } from 'next'

import { draftMode } from 'next/headers'

import { generatePageMetadata, renderPage } from '../../../[slug]/render'

/**
 * Dynamic renderer for draft previews.
 *
 * `proxy.ts` rewrites a request to this route when Next.js' draft cookie is
 * present, keeping the browser URL unchanged. The public `[slug]` route stays
 * free of request-time APIs so its HTML remains cacheable; this route reads
 * `draftMode()` and is therefore never cached.
 */
export const dynamic = 'force-dynamic'

type Args = {
  params: Promise<{
    slug?: string[]
  }>
}

const resolveSlug = (segments?: string[]): string => segments?.join('/') || 'home'

export default async function PreviewPage({ params: paramsPromise }: Args) {
  const { isEnabled: draft } = await draftMode()
  const { slug } = await paramsPromise

  return renderPage({ slug: resolveSlug(slug), draft, track: false })
}

export async function generateMetadata({ params: paramsPromise }: Args): Promise<Metadata> {
  const { isEnabled: draft } = await draftMode()
  const { slug } = await paramsPromise

  return generatePageMetadata({ slug: resolveSlug(slug), draft })
}
