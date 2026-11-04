import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// `shared.tsx` pulls in every block (and Payload's admin UI styles) for the
// generic content layout. This page has no blocks, so stub that one component
// and keep the test on the CV template itself.
vi.mock('@/app/(frontend)/templates/shared', () => ({
  RenderLayout: () => null,
}))

import CVTemplate from '@/app/(frontend)/templates/cv'
import type { PageDoc } from '@/app/(frontend)/templates/shared'
import { CV_PDF_NOTE } from '@/utilities/cvFile'

const cvHtml =
  '<h2 class="docx-title">ROSS MONEY</h2>' +
  '<h3 class="docx-section-rule">SKILLS</h3>' +
  '<ul><li>PHP and Laravel</li><li>Ubuntu</li></ul>' +
  '<table><tr><th scope="col">Stack</th><th scope="col">Years</th></tr>' +
  '<tr><td>PHP</td><td>10+</td></tr></table>' +
  '<p><a href="https://example.com/portfolio">Portfolio</a></p>'

function pageWith(cvFile: PageDoc['cvFile']): PageDoc {
  return {
    id: 'cv-page',
    title: 'CV',
    slug: 'cv',
    template: 'cv',
    lead: 'Download or view my curriculum vitae.',
    cvFile,
  } as unknown as PageDoc
}

const pdfMedia = {
  id: 'cv-media',
  url: '/media/rossmoney_cv.pdf',
  filename: 'rossmoney_cv.pdf',
  cvHtml,
  cvRenderNote: CV_PDF_NOTE,
  createdAt: '',
  updatedAt: '',
}

describe('CV page', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders a real h1, the stored heading outline and the document download', () => {
    const { getByRole, getByText } = render(
      React.createElement(CVTemplate, { page: pageWith(pdfMedia) }),
    )

    expect(getByRole('heading', { level: 1, name: 'Ross Money — Curriculum Vitae' })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: 'ROSS MONEY' })).toBeTruthy()
    expect(getByRole('heading', { level: 3, name: 'SKILLS' })).toBeTruthy()
    expect(getByRole('list')).toBeTruthy()
    expect(getByText('PHP and Laravel')).toBeTruthy()
    expect(getByRole('table')).toBeTruthy()
    expect(getByRole('link', { name: 'Portfolio' }).getAttribute('href')).toBe(
      'https://example.com/portfolio',
    )
    expect(getByRole('link', { name: 'Download CV (PDF)' }).getAttribute('href')).toBe(
      '/media/rossmoney_cv.pdf',
    )
    expect(getByText(CV_PDF_NOTE)).toBeTruthy()
  })

  it('renders the HTML without any client-side parser', () => {
    const { container } = render(
      React.createElement(CVTemplate, { page: pageWith(pdfMedia) }),
    )

    // The document is already in the markup; nothing fetches or parses it.
    expect(container.querySelector('.cv-document')?.textContent).toContain('ROSS MONEY')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('.cv-download-top')?.textContent).toBe('Download CV (PDF)')
  })

  it('falls back to the download when a legacy file has no stored HTML', () => {
    const { getByText, getAllByRole } = render(
      React.createElement(CVTemplate, {
        page: pageWith({ ...pdfMedia, cvHtml: null, cvRenderNote: null }),
      }),
    )

    expect(getByText(/HTML version of this CV is not available yet/)).toBeTruthy()
    const downloadLinks = getAllByRole('link', { name: 'Download CV (PDF)' })
    expect(downloadLinks).toHaveLength(2)
    expect(downloadLinks[0].getAttribute('href')).toBe('/media/rossmoney_cv.pdf')
  })
})
