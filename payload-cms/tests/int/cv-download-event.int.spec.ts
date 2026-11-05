import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CVViewer from '@/components/CVViewer'
import {
  ACKEE_CV_DOWNLOAD_EVENT_ID,
  ACKEE_OPTS,
  ackeeServerURL,
} from '@/utilities/ackeeTracker'

const docxMedia = {
  id: 'current-cv',
  url: '/media/current-cv.docx',
  filename: 'current-cv.docx',
  cvHtml: '<h2>ROSS MONEY</h2><p>Backend developer</p>',
  cvRenderNote: null,
  createdAt: '',
  updatedAt: '',
}

const pdfMedia = {
  ...docxMedia,
  url: '/media/current-cv.pdf',
  filename: 'current-cv.pdf',
  // Empty HTML forces the fallback link rather than the top download bar.
  cvHtml: '',
}

type TrackerWindow = Window & { ackeeTracker?: unknown }

const setTracker = (tracker: unknown) => {
  ;(window as TrackerWindow).ackeeTracker = tracker
}

const clickWithoutNavigating = (link: HTMLElement) => {
  // jsdom otherwise logs "Not implemented: navigation" for a download anchor.
  link.addEventListener('click', (event) => event.preventDefault())
  fireEvent.click(link)
}

afterEach(() => {
  cleanup()
  delete (window as TrackerWindow).ackeeTracker
  vi.restoreAllMocks()
})

describe('CV download event', () => {
  it('records the DOCX action from the top download bar', () => {
    const action = vi.fn<(eventId: string, input: { key: string; value: number }) => void>()
    const create = vi.fn<
      (server: string, options?: Record<string, unknown>) => { action: typeof action }
    >(() => ({ action }))
    setTracker({ create })

    const { getByRole } = render(React.createElement(CVViewer, { cvFile: docxMedia }))
    const link = getByRole('link', { name: 'Download CV (DOCX)' })

    expect(link.getAttribute('href')).toBe('/media/current-cv.docx')
    expect(link.getAttribute('download')).not.toBeNull()
    expect(link.getAttribute('data-cv-download')).toBe('DOCX')

    clickWithoutNavigating(link)

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(
      ackeeServerURL(window.location.origin),
      JSON.parse(ACKEE_OPTS),
    )
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledWith(ACKEE_CV_DOWNLOAD_EVENT_ID, {
      key: 'DOCX',
      value: 1,
    })
  })

  it('records the PDF action from the fallback download link', () => {
    const action = vi.fn<(eventId: string, input: { key: string; value: number }) => void>()
    const create = vi.fn<
      (server: string, options?: Record<string, unknown>) => { action: typeof action }
    >(() => ({ action }))
    setTracker({ create })

    const { getAllByRole, getByText } = render(
      React.createElement(CVViewer, { cvFile: pdfMedia }),
    )

    expect(getByText(/HTML version of this CV is not available/)).toBeTruthy()
    const links = getAllByRole('link', { name: 'Download CV (PDF)' })
    expect(links).toHaveLength(2)

    for (const link of links) {
      expect(link.getAttribute('href')).toBe('/media/current-cv.pdf')
      expect(link.getAttribute('download')).not.toBeNull()
      expect(link.getAttribute('data-cv-download')).toBe('PDF')
      clickWithoutNavigating(link)
    }

    expect(action).toHaveBeenCalledTimes(2)
    expect(action).toHaveBeenCalledWith(ACKEE_CV_DOWNLOAD_EVENT_ID, {
      key: 'PDF',
      value: 1,
    })
  })

  it('keeps the download working when the tracker is absent', () => {
    setTracker(undefined)

    const { getByRole } = render(React.createElement(CVViewer, { cvFile: docxMedia }))
    const link = getByRole('link', { name: 'Download CV (DOCX)' })

    expect(() => clickWithoutNavigating(link)).not.toThrow()
    expect(link.getAttribute('href')).toBe('/media/current-cv.docx')
    expect(link.getAttribute('download')).not.toBeNull()
  })

  it('never lets a failing tracker break the download', () => {
    setTracker({
      create: () => {
        throw new Error('analytics unavailable')
      },
    })

    const { getByRole } = render(React.createElement(CVViewer, { cvFile: docxMedia }))
    const link = getByRole('link', { name: 'Download CV (DOCX)' })

    expect(() => clickWithoutNavigating(link)).not.toThrow()
  })
})
