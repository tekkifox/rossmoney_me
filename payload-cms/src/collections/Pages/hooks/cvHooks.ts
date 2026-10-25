import fs from 'fs/promises'
import path from 'path'
import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'

import type { Media, Page } from '@/payload-types'
import { asRecord } from '@/utilities/json'

/** The CV upload may be a media ID, a populated media doc, or legacy `{ value }` data. */
function cvMediaID(cv: Page['cvFile']): string | null {
  if (!cv) return null
  if (typeof cv === 'string') return cv

  const record = asRecord(cv)
  if (typeof record.id === 'string') return record.id
  if (typeof record.value === 'string') return record.value
  return null
}

/** `fileName` is a legacy alias for `filename` that still exists on older media docs. */
function mediaFilename(media: Media): string {
  if (media.filename) return media.filename
  if ('fileName' in media && typeof media.fileName === 'string') return media.fileName
  return ''
}

// Validate that the selected media is a .docx file
export const validateCVFile: CollectionBeforeChangeHook<Page> = async ({ req, data }) => {
  try {
    const id = cvMediaID(data?.cvFile)
    if (!id) return

    const media = await req.payload.findByID({ collection: 'media', id, depth: 0, req, disableErrors: true })
    if (!media) return

    const filename = mediaFilename(media)
    if (!filename.toLowerCase().endsWith('.docx')) {
      throw new Error('CV file must be a .docx file')
    }
  } catch (e) {
    throw e
  }
}

// Copy the uploaded media file to public/media/rossmoney_cv.docx for static access
export const syncCVToPublic: CollectionAfterChangeHook<Page> = async ({ req, doc }) => {
  try {
    const id = cvMediaID(doc?.cvFile)
    if (!id) return

    const media = await req.payload.findByID({ collection: 'media', id, depth: 0, req, disableErrors: true })
    if (!media) return

    const filename = mediaFilename(media)
    if (!filename.toLowerCase().endsWith('.docx')) return

    const src = path.resolve(process.cwd(), 'public', 'media', filename)
    const dest = path.resolve(process.cwd(), 'public', 'media', 'rossmoney_cv.docx')

    // Copy file (overwrite) if it exists locally
    try {
      await fs.copyFile(src, dest)
      // ensure file permissions are reasonable (optional)
      try { await fs.chmod(dest, 0o644) } catch { /* ignore */ }
      return
    } catch (err) {
      // fall through to attempt download from media URL
      console.warn(`Local media file not found at ${src}, will attempt to download from media URL: ${err}`)
    }

    // If the local file wasn't available (e.g., uploads stored remotely), try to download from media.url
    try {
      const mediaUrl = media.url || null
      if (!mediaUrl) return
      const r = await fetch(mediaUrl)
      if (!r.ok) {
        return
      }
      const buffer = await r.arrayBuffer()
      await fs.writeFile(dest, Buffer.from(buffer))
      try { await fs.chmod(dest, 0o644) } catch { /* ignore */ }
      return
    } catch {
      // ignore download failures
    }
  } catch (e) {
    // do not block the save on copy failure; log to server console
    console.warn('syncCVToPublic failed', e)
  }
}
