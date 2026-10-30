import { describe, expect, it } from 'vitest'

import { createArchitectureGet } from '@/app/api/architecture/route'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('architecture proxy cache', () => {
  it('does not hit upstream on a second identical request inside the TTL', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({ title: 'cached' })
    }
    const GET = createArchitectureGet({
      env: {},
      fetchImpl,
      lookupSource: async () => null,
      lookupDefaultSource: async () => null,
    })

    await GET(new Request('https://cms.example/api/architecture?project=p&t=1'))
    await GET(new Request('https://cms.example/api/architecture?project=p&t=2'))

    expect(calls).toBe(1)
  })

  it('hits upstream again after the TTL', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({ title: 'cached' })
    }
    const GET = createArchitectureGet({
      env: {},
      fetchImpl,
      lookupSource: async () => null,
      lookupDefaultSource: async () => null,
    })

    await GET(new Request('https://cms.example/api/architecture?project=p'))
    await new Promise((resolve) => setTimeout(resolve, 5100))
    await GET(new Request('https://cms.example/api/architecture?project=p'))

    expect(calls).toBe(2)
  })

  it('does not cache an upstream failure', async () => {
    let calls = 0
    let mode: 'fail' | 'ok' = 'fail'
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (mode === 'fail') {
        return new Response('boom', { status: 500 })
      }
      return jsonResponse({ title: 'ok' })
    }
    const GET = createArchitectureGet({
      env: {},
      fetchImpl,
      lookupSource: async () => null,
      lookupDefaultSource: async () => null,
    })

    await GET(new Request('https://cms.example/api/architecture?project=p'))
    mode = 'ok'
    await GET(new Request('https://cms.example/api/architecture?project=p'))

    expect(calls).toBe(2)
  })

  it('coalesces concurrent requests into one upstream call', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 50))
      return jsonResponse({ title: 'coalesced' })
    }
    const GET = createArchitectureGet({
      env: {},
      fetchImpl,
      lookupSource: async () => null,
      lookupDefaultSource: async () => null,
    })

    const [first, second] = await Promise.all([
      GET(new Request('https://cms.example/api/architecture?project=p')),
      GET(new Request('https://cms.example/api/architecture?project=p')),
    ])

    expect(calls).toBe(1)
    expect(await first.json()).toEqual({ title: 'coalesced' })
    expect(await second.json()).toEqual({ title: 'coalesced' })
  })
})