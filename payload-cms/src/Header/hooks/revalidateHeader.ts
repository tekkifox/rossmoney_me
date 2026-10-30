import type { GlobalAfterChangeHook } from 'payload'

import { revalidateTag } from 'next/cache'

export const revalidateHeader: GlobalAfterChangeHook = ({ doc, req: { payload, context } }) => {
  if (!context.disableRevalidate) {
    payload.logger.info(`Revalidating header`)

    revalidateTag('global_header', 'max')
    // The pages sitemap is derived from the header, so a navigation change has
    // to invalidate it as well.
    revalidateTag('pages-sitemap', 'max')
  }

  return doc
}
