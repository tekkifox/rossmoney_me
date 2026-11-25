import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { describe, afterEach, expect, it } from 'vitest'

import CVViewer from '@/components/CVViewer'
import { Media } from '@/collections/Media'
import { Pages } from '@/collections/Pages'
import { authenticated } from '@/access/authenticated'
import { authenticatedOrPublished } from '@/access/authenticatedOrPublished'
import { anyone } from '@/access/anyone'

const docxMedia = {
  id: 'current-cv',
  url: '/media/current-cv.docx',
  filename: 'current-cv.docx',
  cvHtml: '<h2>ROSS MONEY</h2><p>Backend developer</p>',
  cvRenderNote: null,
  createdAt: '',
  updatedAt: '',
}

describe('CV document', () => {
  afterEach(() => {
    cleanup()
  })

  it('serves the stored HTML and downloads the document selected in the CMS', () => {
    const { getByRole, getByText } = render(
      React.createElement(CVViewer, { cvFile: docxMedia }),
    )

    expect(getByRole('link', { name: 'Download CV (DOCX)' }).getAttribute('href'))
      .toBe('/media/current-cv.docx')
    expect(getByRole('heading', { level: 2, name: 'ROSS MONEY' })).toBeTruthy()
    expect(getByText('Backend developer')).toBeTruthy()
  })

  it('labels a PDF download and explains the best-effort text rendering', () => {
    const { getByRole, getByText } = render(
      React.createElement(CVViewer, {
        cvFile: {
          ...docxMedia,
          url: '/media/current-cv.pdf',
          filename: 'current-cv.pdf',
          cvRenderNote: 'Extracted from PDF text.',
        },
      }),
    )

    expect(getByRole('link', { name: 'Download CV (PDF)' }).getAttribute('href'))
      .toBe('/media/current-cv.pdf')
    expect(getByText('Extracted from PDF text.')).toBeTruthy()
  })

  it('shows a graceful unavailable state when the CMS CV field is empty', () => {
    const { getByText, queryByRole } = render(React.createElement(CVViewer, { cvFile: null }))

    expect(getByText('CV document is not available right now.')).toBeTruthy()
    expect(queryByRole('link', { name: 'Download CV (DOCX)' })).toBeNull()
  })

  it('keeps media public for reads while requiring authentication for writes', () => {
    expect(Media.access?.read).toBe(anyone)
    expect(Media.access?.create).toBe(authenticated)
    expect(Media.access?.update).toBe(authenticated)
    expect(Media.access?.delete).toBe(authenticated)
    expect(anyone({ req: { user: null } } as Parameters<typeof anyone>[0])).toBe(true)
    expect(authenticated({ req: { user: null } } as Parameters<typeof authenticated>[0])).toBe(false)
  })

  it('keeps page writes authenticated and limits public reads to published pages', () => {
    expect(Pages.access?.create).toBe(authenticated)
    expect(Pages.access?.update).toBe(authenticated)
    expect(Pages.access?.delete).toBe(authenticated)
    expect(Pages.access?.read).toBe(authenticatedOrPublished)
    expect(authenticatedOrPublished({ req: { user: null } } as Parameters<typeof authenticatedOrPublished>[0]))
      .toEqual({ _status: { equals: 'published' } })
  })
})
