import { describe, expect, it } from 'vitest'

import { resolveArchviewSource } from '@/app/api/architecture/route'

const env = {
  ARCHVIEW_URL: 'https://archview.rossmoney.me',
  ARCHVIEW_ALLOWED_SOURCES: 'https://archview.vortexservers.co.uk, https://archview.example.com',
}

describe('resolveArchviewSource', () => {
  it('accepts the configured ARCHVIEW_URL origin', () => {
    expect(resolveArchviewSource('https://archview.rossmoney.me', env)).toBe(
      'https://archview.rossmoney.me',
    )
  })

  it('accepts an allowlisted origin', () => {
    expect(resolveArchviewSource('https://archview.vortexservers.co.uk', env)).toBe(
      'https://archview.vortexservers.co.uk',
    )
    expect(resolveArchviewSource('https://archview.example.com/some/path', env)).toBe(
      'https://archview.example.com',
    )
  })

  it('rejects non-HTTPS sources', () => {
    expect(resolveArchviewSource('http://archview.vortexservers.co.uk', env)).toBeNull()
  })

  it('rejects private addresses even when they are allowlisted', () => {
    expect(resolveArchviewSource('https://192.168.1.10', env)).toBeNull()
    expect(resolveArchviewSource('https://localhost:8080', env)).toBeNull()
    expect(resolveArchviewSource('https://[::1]', env)).toBeNull()
  })

  it('rejects unlisted hosts and malformed values', () => {
    expect(resolveArchviewSource('https://archview.evil.example', env)).toBeNull()
    expect(resolveArchviewSource('not a url', env)).toBeNull()
    expect(resolveArchviewSource('', env)).toBeNull()
    expect(resolveArchviewSource(null, env)).toBeNull()
  })
})
