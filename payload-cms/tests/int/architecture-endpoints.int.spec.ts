import { describe, expect, it } from 'vitest'

import { parseArchitectureEndpoints } from '@/utilities/architectureEndpoints'

describe('parseArchitectureEndpoints', () => {
  it('keeps ArchView endpoint names and URLs in order', () => {
    const payload = {
      endpoints: [
        { name: 'overview', url: 'https://archview.rossmoney.me/api/overview' },
        {
          name: 'architecture',
          url: 'https://archview.rossmoney.me/api/architecture?project=rossmoney_me',
        },
      ],
    }

    expect(parseArchitectureEndpoints(payload)).toEqual([
      { name: 'overview', url: 'https://archview.rossmoney.me/api/overview' },
      {
        name: 'architecture',
        url: 'https://archview.rossmoney.me/api/architecture?project=rossmoney_me',
      },
    ])
  })

  it('trims surrounding whitespace and ignores extra fields', () => {
    const payload = {
      endpoints: [
        { name: '  overview  ', url: '  https://archview.rossmoney.me/api/overview  ', note: 'x' },
      ],
    }

    expect(parseArchitectureEndpoints(payload)).toEqual([
      { name: 'overview', url: 'https://archview.rossmoney.me/api/overview' },
    ])
  })

  it('drops anything that is not an absolute http(s) URL', () => {
    const payload = {
      endpoints: [
        { name: 'overview', url: 'https://archview.rossmoney.me/api/overview' },
        { name: 'plain http', url: 'http://archview.rossmoney.me/api/overview' },
        { name: 'script', url: 'javascript:alert(1)' },
        { name: 'data', url: 'data:text/html,<script>alert(1)</script>' },
        { name: 'ftp', url: 'ftp://archview.rossmoney.me/file' },
        { name: 'relative', url: '/api/overview' },
        { name: 'malformed', url: 'not a url' },
        { name: 'empty', url: '   ' },
      ],
    }

    expect(parseArchitectureEndpoints(payload)).toEqual([
      { name: 'overview', url: 'https://archview.rossmoney.me/api/overview' },
      { name: 'plain http', url: 'http://archview.rossmoney.me/api/overview' },
    ])
  })

  it('skips entries without a usable name or object shape', () => {
    const payload = {
      endpoints: [
        { name: '', url: 'https://archview.rossmoney.me/api/overview' },
        { url: 'https://archview.rossmoney.me/api/overview' },
        { name: 'no url' },
        { name: 42, url: 'https://archview.rossmoney.me/api/overview' },
        null,
        'https://archview.rossmoney.me/api/overview',
        ['overview', 'https://archview.rossmoney.me/api/overview'],
      ],
    }

    expect(parseArchitectureEndpoints(payload)).toEqual([])
  })

  it('returns an empty list for empty input', () => {
    expect(parseArchitectureEndpoints({ endpoints: [] })).toEqual([])
  })

  it('returns an empty list when endpoints is absent or malformed', () => {
    expect(parseArchitectureEndpoints({})).toEqual([])
    expect(parseArchitectureEndpoints({ endpoints: null })).toEqual([])
    expect(parseArchitectureEndpoints({ endpoints: {} })).toEqual([])
    expect(parseArchitectureEndpoints({ endpoints: 'https://archview.rossmoney.me/api/overview' })).toEqual([])
    expect(parseArchitectureEndpoints(null)).toEqual([])
    expect(parseArchitectureEndpoints(undefined)).toEqual([])
    expect(parseArchitectureEndpoints('payload')).toEqual([])
  })
})
