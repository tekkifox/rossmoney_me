import React from 'react'
import type { Media } from '@/payload-types'
import { cvSourceFromFilename } from '@/utilities/cvFile'
import CVDownloadLink, { type CVDownloadFormat } from './CVDownloadLink'

type Props = {
  cvFile?: Media | string | null
}

export function getCVFileUrl(cvFile: Props['cvFile']) {
  if (!cvFile || typeof cvFile === 'string') return null
  return cvFile.url || (cvFile.filename ? `/media/${cvFile.filename}` : null)
}

function readCvDocument(cvFile: Props['cvFile']): Media | null {
  return cvFile && typeof cvFile === 'object' ? cvFile : null
}

/**
 * Server-rendered CV. The HTML was produced once at upload time and stored on
 * the media document, so the document itself needs no client JavaScript: only
 * the download anchors hydrate, to count the one real conversion. The anchors
 * keep their `href`/`download`, so they still download if that script is
 * absent or fails.
 */
export default function CVViewer({ cvFile }: Props) {
  const cvUrl = getCVFileUrl(cvFile)
  const document = readCvDocument(cvFile)
  const source = cvSourceFromFilename(document?.filename)
  const format = source ? (source.toUpperCase() as CVDownloadFormat) : null
  const downloadLabel = source ? `Download CV (${source.toUpperCase()})` : 'Download CV'
  const html = document?.cvHtml?.trim() ?? ''
  const note = document?.cvRenderNote?.trim() ?? ''

  if (!cvUrl) {
    return (
      <article className="card cv-empty">
        <p>CV document is not available right now.</p>
      </article>
    )
  }

  return (
    <div className="cv-viewer">
      <div className="cv-download-bar">
        <CVDownloadLink className="cv-download-top" href={cvUrl} format={format}>
          {downloadLabel}
        </CVDownloadLink>
      </div>

      {note ? <p className="cv-render-note">{note}</p> : null}

      {html ? (
        <article
          className="card cv-document docx"
          aria-label="Curriculum Vitae"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <article className="card cv-document">
          <p>
            The HTML version of this CV is not available yet. Download the original file to read
            it.
          </p>
          <p>
            <CVDownloadLink href={cvUrl} format={format}>
              {downloadLabel}
            </CVDownloadLink>
          </p>
        </article>
      )}
    </div>
  )
}
