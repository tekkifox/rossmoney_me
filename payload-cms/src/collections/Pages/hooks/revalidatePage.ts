import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

import { revalidateTag } from 'next/cache'

import type { Page } from '../../../payload-types'
import { revalidateArchitectureCache } from '../../../utilities/architectureCache'
import { revalidatePublicPage } from '../../../utilities/revalidatePublicPages'

export const revalidatePage: CollectionAfterChangeHook<Page> = ({
  doc,
  previousDoc,
  req: { payload, context },
}) => {
  if (!context.disableRevalidate) {
    // A page edit can change its ArchView source relation or project, so the
    // shared snapshot cache is stale even when the page stays published.
    revalidateArchitectureCache()

    if (doc._status === 'published') {
      payload.logger.info(`Revalidating page at path: ${doc.slug}`)

      revalidatePublicPage(doc.slug)
      revalidateTag('pages-sitemap', 'max')
    }

    // If the page was previously published, we need to revalidate the old path
    if (previousDoc?._status === 'published' && doc._status !== 'published') {
      payload.logger.info(`Revalidating old page: ${previousDoc.slug}`)

      revalidatePublicPage(previousDoc.slug)
      revalidateTag('pages-sitemap', 'max')
    }
  }
  return doc
}

export const revalidateDelete: CollectionAfterDeleteHook<Page> = ({ doc, req: { context } }) => {
  if (!context.disableRevalidate) {
    revalidateArchitectureCache()
    revalidatePublicPage(doc?.slug)
    revalidateTag('pages-sitemap', 'max')
  }

  return doc
}
