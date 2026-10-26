import { describe, expect, it } from 'vitest'

import {
  isSameOriginRequest,
  normaliseOrigin,
  shouldDropOriginHeader,
} from '@/utilities/adminOrigin'

const trusted = ['https://www.rossmoney.me', 'https://rossmoney-me.vercel.app']

describe('normaliseOrigin', () => {
  it('drops a trailing slash and any path', () => {
    expect(normaliseOrigin('https://www.rossmoney.me/')).toBe('https://www.rossmoney.me')
    expect(normaliseOrigin('https://www.rossmoney.me/admin')).toBe('https://www.rossmoney.me')
  })

  it('rejects unusable values', () => {
    expect(normaliseOrigin('')).toBeNull()
    expect(normaliseOrigin(null)).toBeNull()
    expect(normaliseOrigin('not a url')).toBeNull()
  })
})

describe('isSameOriginRequest', () => {
  it('accepts a request whose origin matches its host', () => {
    expect(
      isSameOriginRequest({
        host: 'dev.rossmoney.me',
        origin: 'https://dev.rossmoney.me',
        protocol: 'https',
      }),
    ).toBe(true)
  })

  it('accepts a forwarded protocol header with a trailing colon', () => {
    expect(
      isSameOriginRequest({
        host: 'dev.rossmoney.me',
        origin: 'https://dev.rossmoney.me',
        protocol: 'https:',
      }),
    ).toBe(true)
  })

  it('rejects a different host', () => {
    expect(
      isSameOriginRequest({
        host: 'dev.rossmoney.me',
        origin: 'https://evil.example',
        protocol: 'https',
      }),
    ).toBe(false)
  })

  it('rejects a different scheme', () => {
    expect(
      isSameOriginRequest({
        host: 'dev.rossmoney.me',
        origin: 'http://dev.rossmoney.me',
        protocol: 'https',
      }),
    ).toBe(false)
  })

  it('rejects a missing origin or host', () => {
    expect(isSameOriginRequest({ host: 'dev.rossmoney.me', origin: null, protocol: 'https' })).toBe(
      false,
    )
    expect(
      isSameOriginRequest({ host: null, origin: 'https://dev.rossmoney.me', protocol: 'https' }),
    ).toBe(false)
  })
})

describe('shouldDropOriginHeader', () => {
  it('drops the origin for a same-origin request the allowlist cannot name', () => {
    expect(
      shouldDropOriginHeader(
        { host: 'dev.rossmoney.me', origin: 'https://dev.rossmoney.me', protocol: 'https' },
        trusted,
      ),
    ).toBe(true)
  })

  it('leaves an allowlisted origin alone, so configured deployments are unchanged', () => {
    expect(
      shouldDropOriginHeader(
        { host: 'www.rossmoney.me', origin: 'https://www.rossmoney.me', protocol: 'https' },
        trusted,
      ),
    ).toBe(false)
  })

  it('leaves a cross-site origin alone so the allowlist still rejects it', () => {
    expect(
      shouldDropOriginHeader(
        { host: 'dev.rossmoney.me', origin: 'https://evil.example', protocol: 'https' },
        trusted,
      ),
    ).toBe(false)
  })

  it('leaves requests without an origin alone', () => {
    expect(
      shouldDropOriginHeader(
        { host: 'dev.rossmoney.me', origin: null, protocol: 'https' },
        trusted,
      ),
    ).toBe(false)
  })

  it('treats a trailing slash in the allowlist as the same origin', () => {
    expect(
      shouldDropOriginHeader(
        { host: 'www.rossmoney.me', origin: 'https://www.rossmoney.me', protocol: 'https' },
        ['https://www.rossmoney.me/'],
      ),
    ).toBe(false)
  })
})
