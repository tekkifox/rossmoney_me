import type { GlobalAfterChangeHook } from 'payload'

import { revalidateTag } from 'next/cache'

import { revalidateAllPublicPages } from '@/utilities/revalidatePublicPages'

export const revalidateFooter: GlobalAfterChangeHook = ({ doc, req: { payload, context } }) => {
  if (!context.disableRevalidate) {
    payload.logger.info(`Revalidating footer`)

    revalidateTag('global_footer', 'max')
    // The footer is rendered into every public page (and other globals may be
    // read by the layout), so drop the cached HTML as well.
    revalidateAllPublicPages()
  }

  return doc
}
