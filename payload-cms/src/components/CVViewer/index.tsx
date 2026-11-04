import React from 'react'
import type { Media } from '@/payload-types'
import { cvSourceFromFilename } from '@/utilities/cvFile'

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
 * the media document, so this component has no client JavaScript: the document
 * is part of the first response and works with JS disabled.
 */
export default function CVViewer({ cvFile }: Props) {
  const cvUrl = getCVFileUrl(cvFile)
  const document = readCvDocument(cvFile)
  const source = cvSourceFromFilename(document?.filename)
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
        <a className="cv-download-top" href={cvUrl} download>
          {downloadLabel}
        </a>
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
            <a href={cvUrl} download>
              {downloadLabel}
            </a>
          </p>
        </article>
      )}
    </div>
  )
}
