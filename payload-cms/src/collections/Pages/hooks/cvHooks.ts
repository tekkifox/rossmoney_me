import fs from 'fs/promises'
import path from 'path'

// Validate that the selected media is a .docx file
export async function validateCVFile({ req, data }: any) {
  try {
    const cv = data?.cvFile
    if (!cv) return

    const id = typeof cv === 'string' ? cv : (cv?.id || cv?.value || null)
    if (!id) return

    const media = await req.payload.findByID({ collection: 'media', id, depth: 0, req, disableErrors: true })
    if (!media) return

    const filename = media.filename || media.fileName || ''
    if (!filename.toLowerCase().endsWith('.docx')) {
      throw new Error('CV file must be a .docx file')
    }
  } catch (e) {
    throw e
  }
}

// Copy the uploaded media file to public/media/rossmoney_cv.docx for static access
export async function syncCVToPublic({ req, doc }: any) {
  try {
    const cv = doc?.cvFile
    if (!cv) return

    const id = typeof cv === 'string' ? cv : (cv?.id || cv?.value || null)
    if (!id) return

    const media = await req.payload.findByID({ collection: 'media', id, depth: 0, req, disableErrors: true })
    if (!media) return

    const filename = media.filename || media.fileName || ''
    if (!filename.toLowerCase().endsWith('.docx')) return

    const src = path.resolve(process.cwd(), 'public', 'media', filename)
    const dest = path.resolve(process.cwd(), 'public', 'media', 'rossmoney_cv.docx')

    // Copy file (overwrite) if it exists locally
    try {
      await fs.copyFile(src, dest)
      // ensure file permissions are reasonable (optional)
      try { await fs.chmod(dest, 0o644) } catch (e) { /* ignore */ }
      return
    } catch (err) {
      // fall through to attempt download from media URL
      // eslint-disable-next-line no-console
      console.warn(`Local media file not found at ${src}, will attempt to download from media URL: ${err}`)
    }

    // If the local file wasn't available (e.g., uploads stored remotely), try to download from media.url
    try {
      const mediaUrl = media.url || media?.url || null
      if (!mediaUrl) return
      const r = await fetch(mediaUrl)
      if (!r.ok) {
        return
      }
      const buffer = await r.arrayBuffer()
      await fs.writeFile(dest, Buffer.from(buffer))
      try { await fs.chmod(dest, 0o644) } catch (e) { /* ignore */ }
      return
    } catch (e) {
    }
  } catch (e) {
    // do not block the save on copy failure; log to server console
    // eslint-disable-next-line no-console
    console.warn('syncCVToPublic failed', e)
  }
}
