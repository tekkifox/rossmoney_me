import { describe, expect, it, vi } from 'vitest'

import { renderDiagram } from '@/utilities/archHelpers'
import { loadArchitectureSnapshot } from '@/utilities/architectureSnapshot'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const requestURL = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

const snapshot = {
  title: 'Streaming',
  // ArchView also reports the API it exposes. `renderDiagram` annotates the
  // `/api/architecture` line with the entry named `architecture`, so redaction
  // must leave this array intact.
  endpoints: [
    { name: 'overview', url: 'https://archview.rossmoney.me/api/overview' },
    {
      name: 'architecture',
      url: 'https://archview.rossmoney.me/api/architecture?project=rossmoney_me',
    },
    { name: 'docker', url: 'http://socket-proxy:2375/containers/json' },
  ],
  services: ['portfolio', 'http://socket-proxy:2375'],
  notes: 'Docker socket at http://socket-proxy:2375 is internal',
}

describe('loadArchitectureSnapshot', () => {
  it('fetches the page source, redacts internal endpoints and keeps the endpoints array', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(requestURL(input))
      return jsonResponse(snapshot)
    }

    const payload = await loadArchitectureSnapshot(
      { archviewUrl: 'https://archview.page.example/' },
      { data: {} },
      {
        payload: null,
        env: {},
        fetchImpl,
        project: 'rossmoney_me',
      },
    )

    expect(calls).toEqual([
      'https://archview.page.example/api/architecture?project=rossmoney_me',
    ])
    expect(payload).not.toBeNull()

    // Docker service names are replaced everywhere, including inside strings.
    expect(payload?.services).toEqual(['portfolio', '[internal]'])
    expect(payload?.notes).toBe('Docker socket at [internal] is internal')

    // The public endpoints survive byte for byte and the internal one is
    // redacted in place, so the array still reaches `renderDiagram`.
    expect(Array.isArray(payload?.endpoints)).toBe(true)
    expect(payload?.endpoints).toEqual([
      { name: 'overview', url: 'https://archview.rossmoney.me/api/overview' },
      {
        name: 'architecture',
        url: 'https://archview.rossmoney.me/api/architecture?project=rossmoney_me',
      },
      { name: 'docker', url: '[internal]' },
    ])

    // Explicitly assert the diagram annotation derived from `endpoints`.
    expect(renderDiagram(payload)).toContain(
      '-> /api/architecture (https://archview.rossmoney.me/api/architecture?project=rossmoney_me)',
    )
  })

  it('reads a page-level ArchView URL from the section as well as the page', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(requestURL(input))
      return jsonResponse({ title: 'Section source' })
    }

    await loadArchitectureSnapshot(
      {},
      { archviewUrl: 'https://archview.section.example' },
      { payload: null, env: {}, fetchImpl },
    )

    expect(calls).toEqual(['https://archview.section.example/api/architecture'])
  })

  it('falls back to ARCHVIEW_URL, then localhost, when the page names no source', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(requestURL(input))
      return jsonResponse({ title: 'Fallback' })
    }

    await loadArchitectureSnapshot(
      {},
      {},
      { payload: null, env: { ARCHVIEW_URL: 'https://archview.env.example/' }, fetchImpl },
    )
    await loadArchitectureSnapshot({}, {}, { payload: null, env: {}, fetchImpl })

    expect(calls).toEqual([
      'https://archview.env.example/api/architecture',
      'http://localhost:8080/api/architecture',
    ])
  })

  it('returns null and warns when ArchView answers with an error status', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl: typeof fetch = async () => new Response('unavailable', { status: 503 })

    try {
      await expect(
        loadArchitectureSnapshot(
          { archviewUrl: 'https://archview.page.example' },
          {},
          { payload: null, env: {}, fetchImpl, label: 'travelling' },
        ),
      ).resolves.toBeNull()
      expect(warn).toHaveBeenCalledWith(
        'ArchView returned',
        503,
        '',
        'for',
        'https://archview.page.example/api/architecture',
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('returns null and warns when the fetch itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED')
    }

    try {
      await expect(
        loadArchitectureSnapshot(
          { archviewUrl: 'https://archview.page.example' },
          {},
          { payload: null, env: {}, fetchImpl },
        ),
      ).resolves.toBeNull()
      expect(warn).toHaveBeenCalledWith(
        'Failed to fetch architecture snapshot',
        expect.any(Error),
      )
    } finally {
      warn.mockRestore()
    }
  })
})
