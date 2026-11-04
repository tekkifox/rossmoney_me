import { describe, expect, it } from 'vitest'

import {
  DRAFT_RENDER_PREFIX,
  isPublicPagePath,
  planPublicRequest,
} from '@/utilities/publicPageCache'
import { PUBLIC_PAGE_REVALIDATE_SECONDS, publicPagePaths } from '@/utilities/revalidatePublicPages'

describe('isPublicPagePath', () => {
  it('accepts the homepage and single-segment pages', () => {
    expect(isPublicPagePath('/')).toBe(true)
    expect(isPublicPagePath('/travelling')).toBe(true)
    expect(isPublicPagePath('/game-servers')).toBe(true)
    expect(isPublicPagePath('/cv/')).toBe(true)
  })

  it('rejects Payload, Next.js and file paths', () => {
    for (const pathname of [
      '/admin',
      '/admin/collections/pages',
      '/api/pages',
      '/next/preview',
      '/_next/static/chunk.js',
      '/favicon.svg',
      '/site.webmanifest',
      '/a',
      '/two/segments',
    ]) {
      expect(isPublicPagePath(pathname)).toBe(false)
    }
  })
})

describe('planPublicRequest — the draft-mode gate', () => {
  it('leaves a normal request on the cacheable public route', () => {
    expect(planPublicRequest({ pathname: '/', draftMode: false })).toEqual({ mode: 'public' })
    expect(planPublicRequest({ pathname: '/travelling', draftMode: false })).toEqual({
      mode: 'public',
    })
  })

  it('rewrites a draft-mode request to the dynamic preview renderer', () => {
    expect(planPublicRequest({ pathname: '/travelling', draftMode: true })).toEqual({
      mode: 'preview',
      destination: `${DRAFT_RENDER_PREFIX}/travelling`,
    })
  })

  it('maps the homepage draft to the preview route root', () => {
    expect(planPublicRequest({ pathname: '/', draftMode: true })).toEqual({
      mode: 'preview',
      destination: DRAFT_RENDER_PREFIX,
    })
  })

  it('ignores the draft cookie on non-page routes', () => {
    for (const pathname of ['/admin', '/api/pages', '/next/preview', '/favicon.svg']) {
      expect(planPublicRequest({ pathname, draftMode: true })).toEqual({
        mode: 'other',
      })
    }
  })

  it('normalises a trailing slash before building the destination', () => {
    expect(planPublicRequest({ pathname: '/contact/', draftMode: true })).toEqual({
      mode: 'preview',
      destination: `${DRAFT_RENDER_PREFIX}/contact`,
    })
  })
})

describe('public page revalidation keys', () => {
  it('uses a positive revalidation window', () => {
    expect(PUBLIC_PAGE_REVALIDATE_SECONDS).toBeGreaterThan(0)
  })

  it('revalidates both the rewrite source and destination for the homepage', () => {
    expect(publicPagePaths('home')).toEqual(['/', '/home'])
    expect(publicPagePaths(undefined)).toEqual(['/', '/home'])
  })

  it('revalidates the single path a normal page is cached under', () => {
    expect(publicPagePaths('travelling')).toEqual(['/travelling'])
    expect(publicPagePaths('/contact/')).toEqual(['/contact'])
  })
})
