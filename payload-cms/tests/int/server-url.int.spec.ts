import { describe, expect, it } from 'vitest'
import { resolveServerURL } from '@/utilities/serverURL'

describe('resolveServerURL', () => {
  it('prefers an explicit SERVER_URL over every Vercel variable', () => {
    expect(
      resolveServerURL({
        SERVER_URL: 'https://www.rossmoney.me',
        NEXT_PUBLIC_SERVER_URL: 'https://public.example.com',
        VERCEL_URL: 'deployment.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'production.example.com',
      }),
    ).toBe('https://www.rossmoney.me')
  })

  it('falls back to NEXT_PUBLIC_SERVER_URL when SERVER_URL is unset', () => {
    expect(
      resolveServerURL({
        NEXT_PUBLIC_SERVER_URL: 'https://public.example.com',
        VERCEL_URL: 'deployment.vercel.app',
      }),
    ).toBe('https://public.example.com')
  })

  it('uses the deployment URL on Vercel, ahead of the production alias', () => {
    expect(
      resolveServerURL({
        VERCEL_URL: 'my-site-abc123.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'www.rossmoney.me',
      }),
    ).toBe('https://my-site-abc123.vercel.app')
  })

  it('uses the production alias when VERCEL_URL is unavailable', () => {
    expect(
      resolveServerURL({ VERCEL_PROJECT_PRODUCTION_URL: 'www.rossmoney.me' }),
    ).toBe('https://www.rossmoney.me')
  })

  it('falls back to the localhost URL when nothing is configured', () => {
    expect(resolveServerURL({})).toBe('http://localhost:8082')
  })

  it('ignores empty values and keeps looking', () => {
    expect(
      resolveServerURL({
        SERVER_URL: '',
        NEXT_PUBLIC_SERVER_URL: '',
        VERCEL_URL: '',
        VERCEL_PROJECT_PRODUCTION_URL: 'www.rossmoney.me',
      }),
    ).toBe('https://www.rossmoney.me')
  })
})
