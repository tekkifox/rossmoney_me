import type { Payload } from 'payload'

import type { Page } from '@/payload-types'

type PageWithCvFile = Pick<Page, 'cvFile'>

/**
 * A page read at depth 0 carries an upload relation as its media id. The CV
 * viewer cannot render an id, so resolve it before the template runs. Media
 * reads are public (`access.read: anyone`), so this stays an anonymous read;
 * a document that cannot be read keeps the id and the viewer shows its
 * graceful empty state instead of failing the request.
 */
export async function populateCvFile<T extends PageWithCvFile>(
  payload: Payload,
  page: T,
): Promise<T> {
  if (typeof page.cvFile !== 'string') return page

  try {
    const media = await payload.findByID({
      collection: 'media',
      id: page.cvFile,
      depth: 0,
      overrideAccess: false,
      disableErrors: true,
    })

    return media ? { ...page, cvFile: media } : page
  } catch {
    return page
  }
}
