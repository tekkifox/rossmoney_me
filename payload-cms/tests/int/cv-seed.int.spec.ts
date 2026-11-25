// @vitest-environment node
//
// The CV page is only usable when its upload relation is populated. A fresh
// seed used to create the page with no document at all, so every seeded
// environment (the dev deployment, the browser-smoke database) rendered the
// "CV document is not available" card. These assertions drive the same local
// API reads the public route uses.
import type { Payload, SanitizedConfig } from 'payload'
import { getPayload, handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { attachSeededCv, CV_SEED_ALT } from '@/endpoints/seed/cv-page'
import { populateCvFile } from '@/utilities/cvPageFile'
import type { Media } from '@/payload-types'

const SEED_TEST_BLOB_TOKEN = 'vercel_blob_rw_seedtest_0123456789abcdef'

const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN
delete process.env.BLOB_READ_WRITE_TOKEN

// Payload renames an upload when the filename is already on disk
// (`rossmoney_cv-sample-2.docx`), so only the stem is guaranteed.
const SEEDED_FILENAME = /^rossmoney_cv-sample(-\d+)?\.docx$/

let payload: Payload
let payloadConfig: SanitizedConfig
let seededMedia: Media

const findCvPage = async (depth: number) => {
  const result = await payload.find({
    collection: 'pages',
    depth,
    limit: 1,
    pagination: false,
    overrideAccess: false,
    where: { slug: { equals: 'cv' } },
  })

  return result.docs[0]
}

const restoreBlobToken = () => {
  if (previousBlobToken === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken
  }
}

describe('seeded CV page', () => {
  beforeAll(async () => {
    const { default: config } = await import('@/payload.config')
    payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
  }, 120_000)

  afterAll(async () => {
    await payload.destroy()

    if (previousBlobToken !== undefined) {
      process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken
    }
  })

  it('links a seeded document so the viewer never receives an empty relation', async () => {
    const page = await findCvPage(2)

    expect(page, 'the default CV page should be seeded').toBeDefined()
    expect(page.cvFile, 'the seeded CV page must reference a media document').toBeTruthy()
    expect(typeof page.cvFile).toBe('object')

    seededMedia = page.cvFile as Media
    expect(seededMedia.alt).toBe(CV_SEED_ALT)
    expect(seededMedia.filename).toMatch(SEEDED_FILENAME)
    expect(seededMedia.url).toContain('/api/media/file/')
    expect(seededMedia.cvHtml ?? '').toContain('ROSS MONEY')
  })

  it('resolves a shallow page relation before handing it to the viewer', async () => {
    const shallow = await findCvPage(0)

    // A depth-0 read is the shape that used to reach CVViewer as a bare id.
    expect(typeof shallow.cvFile).toBe('string')

    const page = await populateCvFile(payload, shallow)

    expect(typeof page.cvFile).toBe('object')
    expect((page.cvFile as Media).filename).toBe(seededMedia.filename)
  })

  it('serves the seeded document from the media route', async () => {
    const response = await handleEndpoints({
      config: payloadConfig,
      request: new Request(
        `http://localhost:3000/api/media/file/${encodeURIComponent(seededMedia.filename as string)}`,
      ),
    })

    expect(response.status).toBe(200)
    const body = Buffer.from(await response.arrayBuffer())
    expect(body.byteLength).toBeGreaterThan(0)
  })

  it('links the sample only when the relation is empty and never replaces it later', async () => {
    const page = await findCvPage(0)
    expect(page).toBeDefined()

    // Simulate a database seeded before the sample existed: the page has no
    // upload of its own.
    await payload.update({
      collection: 'pages',
      id: page.id,
      data: { cvFile: null },
      context: { disableRevalidate: true },
    })
    expect((await findCvPage(0)).cvFile).toBeFalsy()

    process.env.BLOB_READ_WRITE_TOKEN = SEED_TEST_BLOB_TOKEN
    try {
      // A later startup must still seed and attach the sample even though
      // uploads are handled by blob storage.
      await payloadConfig.onInit?.(payload)

      const reattached = await findCvPage(0)
      expect(reattached.cvFile, 'the restart should link the sample document').toBeTruthy()
      const attachedId = reattached.cvFile

      // A further startup must leave the now-populated relation alone.
      await payloadConfig.onInit?.(payload)
      expect((await findCvPage(0)).cvFile).toBe(attachedId)

      // An editor's document is never replaced either: the helper refuses a
      // page that already points at a document.
      expect(await attachSeededCv(payload, { id: page.id, cvFile: attachedId })).toBe(false)
    } finally {
      restoreBlobToken()
    }
  })
})
