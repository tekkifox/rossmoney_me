// @vitest-environment node
//
// This spec drives Payload's REST route directly, so it needs a plain Node
// realm for the same reason as `client-uploads.int.spec.ts`.
import type { Payload, SanitizedConfig } from 'payload'
import { getPayload, handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The self-hosted deployment runs without `BLOB_READ_WRITE_TOKEN` and serves
 * media from `public/media`. Clear any inherited token before the config is
 * imported so the collection takes its local-disk branch.
 */
const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN
delete process.env.BLOB_READ_WRITE_TOKEN

let payload: Payload
let payloadConfig: SanitizedConfig
const createdMediaIds: Array<number | string> = []

const fetchMediaFile = (filename: string) =>
  handleEndpoints({
    config: payloadConfig,
    request: new Request(`http://localhost:3000/api/media/file/${filename}`),
  })

describe('Media file route without Vercel Blob', () => {
  beforeAll(async () => {
    const { default: config } = await import('@/payload.config')
    payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
  }, 120_000)

  afterAll(async () => {
    for (const id of createdMediaIds) {
      await payload.delete({ collection: 'media', id })
    }
    await payload.destroy()

    if (previousBlobToken !== undefined) {
      process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken
    }
  })

  it('answers a filename with no media document with 404, not 500', async () => {
    const response = await fetchMediaFile('does-not-exist.docx')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ errors: [{ message: 'Not Found' }] })
  })

  it('serves an existing local upload with 200', async () => {
    const body = 'local media file'
    const doc = await payload.create({
      collection: 'media',
      data: { alt: 'Media file route test' },
      file: {
        data: Buffer.from(body),
        mimetype: 'text/plain',
        name: `media-file-route-${Date.now()}.txt`,
        size: Buffer.byteLength(body),
      },
    })
    createdMediaIds.push(doc.id)

    const response = await fetchMediaFile(doc.filename as string)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(body)
  })
})
