import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'

import type { Media } from '@/payload-types'
import { isCvFilename } from '@/utilities/cvFile'
import { convertCvFile, cvRenderFailureNote } from '@/utilities/cvRender'
import {
  revalidateAllPublicPages,
  revalidatePublicPage,
} from '@/utilities/revalidatePublicPages'

/**
 * Render a CV once, when its file is uploaded or replaced. Payload has already
 * written the incoming file to `req.file` by the time a collection
 * `beforeChange` hook runs, so the HTML is stored on the same media document
 * and the public page never parses the document in the browser.
 *
 * `context.skipCvRender` lets the backfill task persist an existing conversion
 * without triggering another one.
 */
export const renderCvOnUpload: CollectionBeforeChangeHook = async ({ data, req }) => {
  if (req.context?.skipCvRender) return data

  const file = req.file
  if (!file?.data) return data

  const filename = file.name || (typeof data?.filename === 'string' ? data.filename : '')
  if (!isCvFilename(filename)) return data

  try {
    const result = await convertCvFile({ buffer: file.data, filename })
    return {
      ...data,
      cvHtml: result.html,
      cvRenderNote: result.note ?? null,
    }
  } catch (error) {
    req.payload.logger.error(
      `CV conversion failed for ${filename}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return {
      ...data,
      cvHtml: '',
      cvRenderNote: cvRenderFailureNote(error),
    }
  }
}

/**
 * Public pages are cached now, and the stored CV HTML is part of that cached
 * page. Invalidate the pages that actually reference this media when a
 * CV is uploaded or replaced so `/cv` picks up the new document immediately;
 * fall back to the whole public cache if the lookup cannot run.
 */
export const revalidateCvPages: CollectionAfterChangeHook<Media> = async ({ doc, req }) => {
  if (req.context?.skipCvRender || req.context?.disableRevalidate) return doc
  if (!isCvFilename(doc.filename)) return doc

  try {
    const pages = await req.payload.find({
      collection: 'pages',
      where: { cvFile: { equals: doc.id } },
      depth: 0,
      limit: 50,
      pagination: false,
      overrideAccess: true,
      req,
    })

    if (pages.docs.length === 0) {
      revalidateAllPublicPages()
    } else {
      for (const page of pages.docs) {
        revalidatePublicPage(page.slug)
      }
    }
  } catch {
    revalidateAllPublicPages()
  }

  return doc
}
