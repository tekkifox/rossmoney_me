import { describe, expect, it } from 'vitest'
import { formatAdminURL } from 'payload/shared'

import { isVercelRuntime, resolveServerURL } from '@/utilities/serverURL'

describe('resolveServerURL', () => {
  it('prefers an explicit SERVER_URL over every Vercel variable', () => {
    expect(
      resolveServerURL({
        SERVER_URL: 'https://www.rossmoney.me/',
        NEXT_PUBLIC_SERVER_URL: 'https://public.example.com',
        VERCEL: '1',
        VERCEL_URL: 'deployment.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'production.example.com',
      }),
    ).toBe('https://www.rossmoney.me/')
  })

  it('keeps the configured origin byte for byte so Portainer is unchanged', () => {
    // The Portainer stack sets SERVER_URL with a trailing slash and the admin's
    // embedded client config has always read exactly that value.
    expect(resolveServerURL({ SERVER_URL: 'https://www.rossmoney.me/' })).toBe(
      'https://www.rossmoney.me/',
    )
  })

  it('falls back to NEXT_PUBLIC_SERVER_URL when SERVER_URL is unset', () => {
    expect(
      resolveServerURL({
        NEXT_PUBLIC_SERVER_URL: 'https://public.example.com',
        VERCEL: '1',
        VERCEL_URL: 'deployment.vercel.app',
      }),
    ).toBe('https://public.example.com')
  })

  it('stays unset on Vercel, even though Vercel publishes hostnames', () => {
    expect(
      resolveServerURL({
        VERCEL: '1',
        VERCEL_URL: 'my-site-abc123.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'www.rossmoney.me',
      }),
    ).toBe('')
  })

  it('stays unset on Vercel when only some Vercel variables are present', () => {
    expect(resolveServerURL({ VERCEL: '1' })).toBe('')
    expect(resolveServerURL({ VERCEL_URL: 'my-site-abc123.vercel.app' })).toBe('')
    expect(resolveServerURL({ VERCEL_PROJECT_PRODUCTION_URL: 'www.rossmoney.me' })).toBe('')
  })

  it('falls back to the localhost URL when nothing is configured', () => {
    expect(resolveServerURL({})).toBe('http://localhost:8082')
  })

  it('ignores empty values and keeps looking', () => {
    expect(
      resolveServerURL({
        SERVER_URL: '',
        NEXT_PUBLIC_SERVER_URL: '',
        VERCEL: '',
        VERCEL_URL: '',
        VERCEL_PROJECT_PRODUCTION_URL: '',
      }),
    ).toBe('http://localhost:8082')
  })

  it('detects the Vercel runtime from any of its variables', () => {
    expect(isVercelRuntime({})).toBe(false)
    expect(isVercelRuntime({ PORT: '3000' })).toBe(false)
    expect(isVercelRuntime({ VERCEL: '1' })).toBe(true)
    expect(isVercelRuntime({ VERCEL_URL: 'deployment.vercel.app' })).toBe(true)
    expect(isVercelRuntime({ VERCEL_PROJECT_PRODUCTION_URL: 'www.rossmoney.me' })).toBe(true)
  })
})

describe('media URLs built from the resolved serverURL', () => {
  // Payload absolutises upload `url` / `thumbnailURL` through `formatAdminURL`,
  // which is a no-op prefix when `serverURL` is empty.
  const mediaUrl = (serverURL: string) =>
    formatAdminURL({
      apiRoute: '/api',
      path: '/media/file/rossmoney_cv.docx',
      relative: false,
      serverURL,
    })

  it('stays relative on Vercel', () => {
    const onVercel = resolveServerURL({
      VERCEL: '1',
      VERCEL_URL: 'my-site-abc123.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'www.rossmoney.me',
    })

    expect(mediaUrl(onVercel)).toBe('/api/media/file/rossmoney_cv.docx')
  })

  it('is absolute where an explicit origin is configured', () => {
    const onPortainer = resolveServerURL({ SERVER_URL: 'https://www.rossmoney.me/' })

    expect(mediaUrl(onPortainer)).toBe(
      'https://www.rossmoney.me/api/media/file/rossmoney_cv.docx',
    )
  })
})
