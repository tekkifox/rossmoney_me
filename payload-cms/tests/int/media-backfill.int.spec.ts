// @vitest-environment node
//
// The route and both external dependencies are mocked: no Blob token, no
// network and no Payload startup. This keeps the test runnable anywhere the
// normal integration suite runs.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMediaBackfillPost,
  type MediaBackfillPayload,
  type MediaBackfillRouteDeps,
} from '@/app/api/media/backfill/route'
import type {
  MediaBackfillDocument,
  MediaBackfillStore,
} from '@/utilities/mediaBackfill'

const ALLOWED_HOST = 'media.example'
const DEFAULT_SOURCE = `https://${ALLOWED_HOST}`

const request = (body?: unknown): Request =>
  new Request('http://localhost/api/media/backfill', {
    method: 'POST',
    headers: {
      authorization: 'JWT test-token',
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

function fakePayload(options: {
  user?: { collection?: string } | null
  docs?: MediaBackfillDocument[]
} = {}) {
  const find = vi.fn<MediaBackfillPayload['find']>(async () => ({ docs: options.docs ?? [] }))
  const payload: MediaBackfillPayload = {
    auth: vi.fn<MediaBackfillPayload['auth']>(async () => ({
      responseHeaders: new Headers({ 'x-payload-auth': 'refreshed' }),
      user: 'user' in options ? options.user : { collection: 'users' },
    })),
    find,
  }

  return { payload, find }
}

function fakeStore(existing: string[] = []) {
  const present = new Set(existing)

  const head = vi.fn<MediaBackfillStore['head']>(async (pathname) => {
    if (present.has(pathname)) {
      return { size: 1 }
    }
    throw new Error('BlobNotFoundError')
  })

  const put = vi.fn<MediaBackfillStore['put']>(async (pathname) => {
    present.add(pathname)
    return { pathname }
  })

  return { head, put, present, store: { head, put } satisfies MediaBackfillStore }
}

function fakeFetch(
  files: Record<string, { body: string; contentType?: string; status?: number }>,
) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const filename = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1))
    const file = files[filename]

    if (!file || file.status === 404) {
      return new Response('not found', { status: 404 })
    }

    return new Response(file.body, {
      status: file.status ?? 200,
      headers: file.contentType ? { 'content-type': file.contentType } : undefined,
    })
  }) as unknown as typeof fetch
}

const handlerFor = (options: {
  payload: MediaBackfillPayload
  store: MediaBackfillStore
  fetchImpl: typeof fetch
  token?: string | null
  defaultSource?: string
}) =>
  createMediaBackfillPost({
    loadPayload: async () => options.payload,
    store: options.store,
    fetchImpl: options.fetchImpl,
    token: options.token === undefined ? 'test-blob-token' : options.token,
    allowedHosts: [ALLOWED_HOST],
    defaultSource: options.defaultSource ?? DEFAULT_SOURCE,
    perFileTimeoutMs: 1_000,
    concurrency: 2,
  } satisfies MediaBackfillRouteDeps)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/media/backfill', () => {
  it('answers anonymous callers with 404 and no hint that the route exists', async () => {
    const { payload, find } = fakePayload({ user: null })
    const { store, head } = fakeStore()
    const fetchImpl = fakeFetch({})

    const response = await handlerFor({ payload, store, fetchImpl })(request({}))

    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ errors: [{ message: 'Not found' }] })
    expect(find).not.toHaveBeenCalled()
    expect(head).not.toHaveBeenCalled()
  })

  it('refuses an authenticated user from a non-admin collection', async () => {
    const { payload } = fakePayload({ user: { collection: 'members' } })
    const { store } = fakeStore()

    const response = await handlerFor({ payload, store, fetchImpl: fakeFetch({}) })(request({}))

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('answers 503 when Vercel Blob is not configured', async () => {
    const { payload } = fakePayload()

    const response = await handlerFor({
      payload,
      store: fakeStore().store,
      fetchImpl: fakeFetch({}),
      token: null,
    })(request({}))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining('BLOB_READ_WRITE_TOKEN'),
    })
  })

  it('rejects a source that is not https or is not on the allow-list', async () => {
    const { payload, find } = fakePayload()
    const handler = handlerFor({
      payload,
      store: fakeStore().store,
      fetchImpl: fakeFetch({}),
    })

    const insecure = await handler(request({ source: `http://${ALLOWED_HOST}/media` }))
    expect(insecure.status).toBe(400)

    const foreign = await handler(request({ source: 'https://evil.example/media' }))
    expect(foreign.status).toBe(400)
    expect(await foreign.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining('allow-list'),
    })

    expect(find).not.toHaveBeenCalled()
  })

  it('skips a file that is already in the store without fetching it', async () => {
    const { payload } = fakePayload({ docs: [{ filename: 'present.png' }] })
    const { store, put } = fakeStore(['present.png'])
    const fetchImpl = fakeFetch({ 'present.png': { body: 'new bytes' } })

    const response = await handlerFor({ payload, store, fetchImpl })(request({}))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      uploaded: [],
      skipped: ['present.png'],
      failed: [],
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('downloads a missing original from the source and uploads it to Blob', async () => {
    const { payload } = fakePayload({ docs: [{ filename: 'photo one.png' }] })
    const { store, put } = fakeStore()
    const fetchImpl = fakeFetch({
      'photo one.png': { body: 'image bytes', contentType: 'image/png' },
    })

    const response = await handlerFor({ payload, store, fetchImpl })(request({}))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      uploaded: ['photo one.png'],
      skipped: [],
      failed: [],
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      `${DEFAULT_SOURCE}/photo%20one.png`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(put).toHaveBeenCalledTimes(1)

    const [pathname, body, options] = put.mock.calls[0]
    expect(pathname).toBe('photo one.png')
    expect(Buffer.from(body).toString()).toBe('image bytes')
    expect(options).toMatchObject({
      token: 'test-blob-token',
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'image/png',
    })
    expect(options.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('reports what it would upload in a dry run without fetching or writing', async () => {
    const { payload } = fakePayload({
      docs: [{ filename: 'missing.png' }, { filename: 'present.png' }],
    })
    const { store, head, put } = fakeStore(['present.png'])
    const fetchImpl = fakeFetch({ 'missing.png': { body: 'image bytes' } })

    const response = await handlerFor({ payload, store, fetchImpl })(
      request({ dryRun: true }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      uploaded: ['missing.png'],
      skipped: ['present.png'],
      failed: [],
    })
    expect(head).toHaveBeenCalledTimes(2)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('skips image size variants the source no longer serves', async () => {
    const { payload } = fakePayload({
      docs: [
        {
          filename: 'photo.png',
          sizes: {
            thumbnail: { filename: 'photo-300x300.png' },
            medium: { filename: 'photo-900x900.png' },
          },
        },
      ],
    })
    const { store, put } = fakeStore()
    const fetchImpl = fakeFetch({
      'photo.png': { body: 'original', contentType: 'image/png' },
      // The medium variant is absent from the production mirror.
    })

    const response = await handlerFor({ payload, store, fetchImpl })(request({}))

    expect(await response.json()).toEqual({
      ok: true,
      uploaded: ['photo.png'],
      skipped: ['photo-300x300.png', 'photo-900x900.png'],
      failed: [],
    })
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('fails the run when the original itself is missing from the source', async () => {
    const { payload } = fakePayload({ docs: [{ filename: 'gone.png' }] })
    const { store, put } = fakeStore()

    const response = await handlerFor({ payload, store, fetchImpl: fakeFetch({}) })(request({}))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: false,
      uploaded: [],
      skipped: [],
      failed: [{ filename: 'gone.png', error: 'The source answered 404.' }],
    })
    expect(put).not.toHaveBeenCalled()
  })

  it('uses MEDIA_SOURCE when the body omits a source', async () => {
    vi.stubEnv('MEDIA_SOURCE', `https://${ALLOWED_HOST}/mirror`)
    const { payload } = fakePayload({ docs: [{ filename: 'mirror.png' }] })
    const { store } = fakeStore()
    const fetchImpl = fakeFetch({ 'mirror.png': { body: 'mirror bytes' } })

    const response = await handlerFor({ payload, store, fetchImpl })(request({}))

    expect((await response.json()).uploaded).toEqual(['mirror.png'])
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://${ALLOWED_HOST}/mirror/mirror.png`,
      expect.anything(),
    )
  })
})
