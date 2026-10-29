import { afterEach, describe, expect, it } from 'vitest'

import { archviewAuthHeaders, archviewAuthHeadersFor } from '@/utilities/archviewAuth'

const original = process.env.ARCHVIEW_API_KEY

afterEach(() => {
  if (original === undefined) {
    delete process.env.ARCHVIEW_API_KEY
  } else {
    process.env.ARCHVIEW_API_KEY = original
  }
})

describe('archviewAuthHeaders', () => {
  it('omits the header when no key is configured', () => {
    expect(archviewAuthHeaders(undefined)).toEqual({})
    expect(archviewAuthHeaders('')).toEqual({})
    expect(archviewAuthHeaders('   ')).toEqual({})
  })

  it('sends a bare key as a bearer token', () => {
    expect(archviewAuthHeaders('ff9a1c1a0a5c4f67b0b8b1f6d0e2c111')).toEqual({
      Authorization: 'Bearer ff9a1c1a0a5c4f67b0b8b1f6d0e2c111',
    })
  })

  it('takes only the key from the label:key form ArchView accepts', () => {
    expect(archviewAuthHeaders('rossmoney-me:2d3f5a7c9e1b4d6f8a0c2e4b6d8f0a1c')).toEqual({
      Authorization: 'Bearer 2d3f5a7c9e1b4d6f8a0c2e4b6d8f0a1c',
    })
    expect(archviewAuthHeaders('  rossmoney-me: 2d3f5a7c9e1b4d6f8a0c2e4b6d8f0a1c  ')).toEqual({
      Authorization: 'Bearer 2d3f5a7c9e1b4d6f8a0c2e4b6d8f0a1c',
    })
  })

  it('keeps a value with an empty half intact, matching ArchView parsing', () => {
    expect(archviewAuthHeaders(':abc')).toEqual({ Authorization: 'Bearer :abc' })
    expect(archviewAuthHeaders('label:')).toEqual({ Authorization: 'Bearer label:' })
  })

  it('reads ARCHVIEW_API_KEY from the environment by default', () => {
    process.env.ARCHVIEW_API_KEY = 'rossmoney-me:env-key'
    expect(archviewAuthHeaders()).toEqual({ Authorization: 'Bearer env-key' })

    delete process.env.ARCHVIEW_API_KEY
    expect(archviewAuthHeaders()).toEqual({})
  })
})

describe('archviewAuthHeadersFor', () => {
  const env = {
    ARCHVIEW_API_KEY: 'rossmoney-me:secret',
    ARCHVIEW_URL: 'https://archview.rossmoney.me',
  }

  it('signs requests to the configured deployment', () => {
    expect(
      archviewAuthHeadersFor(
        'https://archview.rossmoney.me/api/architecture?project=image-mosaic',
        env,
      ),
    ).toEqual({ Authorization: 'Bearer secret' })
  })

  it('never sends the key to another ArchView instance', () => {
    expect(
      archviewAuthHeadersFor('https://archview.vortexservers.co.uk/api/architecture', env),
    ).toEqual({})
  })

  it('ignores lookalike hosts and relative targets', () => {
    expect(
      archviewAuthHeadersFor('https://archview.rossmoney.me.evil.test/api/architecture', env),
    ).toEqual({})
    expect(archviewAuthHeadersFor('/api/architecture', env)).toEqual({})
  })

  it('falls back to the bare key when no base URL is configured', () => {
    expect(
      archviewAuthHeadersFor('http://localhost:8080/api/architecture', {
        ARCHVIEW_API_KEY: 'dev-key',
      }),
    ).toEqual({ Authorization: 'Bearer dev-key' })
  })
})
