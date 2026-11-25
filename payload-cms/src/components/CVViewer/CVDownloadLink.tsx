'use client'

import type { ReactNode } from 'react'

import {
  ACKEE_CV_DOWNLOAD_EVENT_ID,
  ACKEE_OPTS,
  ackeeServerURL,
} from '@/utilities/ackeeTracker'

export type CVDownloadFormat = 'DOCX' | 'PDF'

type AckeeActionTracker = {
  action?: (eventId: string, input: { key: string; value: number }) => void
}

type AckeeTrackerGlobal = {
  create?: (server: string, options?: Record<string, unknown>) => AckeeActionTracker | undefined
}

/**
 * Record one CV download in Ackee, when the production tracker is present.
 *
 * This is deliberately best-effort: dev, CI and preview build without the
 * tracker, and analytics must never stop the anchor from downloading. A
 * missing global, a stub with no `create`, or a throwing tracker all fall
 * through to the browser's normal download.
 */
export function trackCVDownload(format: CVDownloadFormat | null): void {
  if (!format) {
    return
  }

  try {
    const tracker = (window as Window & { ackeeTracker?: AckeeTrackerGlobal }).ackeeTracker
    if (!tracker || typeof tracker.create !== 'function') {
      return
    }

    const instance = tracker.create(
      ackeeServerURL(window.location.origin),
      JSON.parse(ACKEE_OPTS) as Record<string, unknown>,
    )
    instance?.action?.(ACKEE_CV_DOWNLOAD_EVENT_ID, { key: format, value: 1 })
  } catch {
    // Never let an analytics failure break the download.
  }
}

type Props = {
  href: string
  /**
   * `null` only if a media document has no recognisable extension; uploads are
   * validated to DOCX/PDF, so in practice both anchors name their format.
   */
  format: CVDownloadFormat | null
  className?: string
  children: ReactNode
}

/**
 * A normal download anchor with an opt-in analytics click. The `href` and
 * `download` attributes are always rendered by the server, so the file still
 * downloads with JavaScript disabled or when the tracker is absent.
 */
export function CVDownloadLink({ href, format, className, children }: Props) {
  return (
    <a
      className={className}
      href={href}
      download
      data-cv-download={format}
      onClick={() => trackCVDownload(format)}
    >
      {children}
    </a>
  )
}

export default CVDownloadLink
