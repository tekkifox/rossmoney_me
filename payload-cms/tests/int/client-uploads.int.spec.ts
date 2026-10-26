// @vitest-environment node
//
// This spec drives Payload's REST endpoint directly. It needs a plain Node
// realm because Payload signs the test JWT with jose, which rejects jsdom's
// cross-realm TextEncoder output ("payload must be an instance of Uint8Array").
import type { Config, Payload, SanitizedConfig } from 'payload'
import { getPayload, handleEndpoints } from 'payload'
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The client-upload endpoint is only registered by the Vercel Blob plugin when
 * a token is configured. Give it a syntactically valid one; issuing a client
 * upload receipt is a local HMAC signature, so these tests never contact
 * Vercel.
 */
const TEST_BLOB_TOKEN = 'vercel_blob_rw_teststore_0123456789abcdef'
const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN
process.env.BLOB_READ_WRITE_TOKEN = TEST_BLOB_TOKEN

const ROUTE = '/api/vercel-blob-client-upload-route?issue-client-upload=1'

const testUser = {
  email: 'client-uploads@example.com',
  password: 'client-uploads-password',
}

let payload: Payload
let payloadConfig: SanitizedConfig
let jwt: string

const issueUpload = (headers: Record<string, string> = {}) =>
  handleEndpoints({
    config: payloadConfig,
    request: new Request(`http://localhost:3000${ROUTE}`, {
      body: JSON.stringify({
        collectionSlug: 'media',
        filename: 'large.png',
        mimeType: 'image/png',
      }),
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        ...headers,
      },
      method: 'POST',
    }),
  })

describe('Media client uploads', () => {
  beforeAll(async () => {
    const { default: config } = await import('@/payload.config')
    payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    await payload.delete({
      collection: 'users',
      where: { email: { equals: testUser.email } },
    })
    await payload.create({ collection: 'users', data: testUser })

    const login = await payload.login({ collection: 'users', data: testUser })
    if (!login.token) {
      throw new Error('Expected the seeded user to receive a JWT')
    }
    jwt = login.token
  }, 120_000)

  afterAll(async () => {
    await payload.delete({
      collection: 'users',
      where: { email: { equals: testUser.email } },
    })
    await payload.destroy()

    // Restore the environment so a later spec never inherits a Blob token.
    if (previousBlobToken === undefined) {
      delete process.env.BLOB_READ_WRITE_TOKEN
    } else {
      process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken
    }
  })

  it('refuses an anonymous request for an upload token', async () => {
    const response = await issueUpload()

    expect(response.status).toBe(403)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('clientUploadContext')
    expect(body).not.toHaveProperty('clientToken')
  })

  it('issues a scoped upload receipt to a signed-in admin', async () => {
    const response = await issueUpload({ authorization: `JWT ${jwt}` })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      clientUploadContext?: { signedReceipt?: string }
      filename?: string
      pathname?: string
    }

    expect(body.filename).toBe('large.png')
    // The media collection is folder-enabled, so the storage key is prefixed
    // with the document's folder; the uploaded filename is still the basename.
    expect(body.pathname).toMatch(/large\.png$/)
    // The receipt is what the plugin's token route verifies before it will
    // sign a Vercel client token, so its presence proves the upload path is
    // wired up rather than merely returning 200.
    expect(body.clientUploadContext?.signedReceipt).toEqual(expect.any(String))
  })

  it('leaves the config untouched when no Blob token is configured', async () => {
    const base = {
      collections: [{ slug: 'media', upload: true }],
    } as unknown as Config

    const result = (await vercelBlobStorage({
      clientUploads: true,
      collections: { media: true },
      // This is the self-hosted Portainer case.
      token: undefined,
    })(base)) as Config & { endpoints?: Array<{ path?: string }> }

    expect(result.endpoints ?? []).not.toContainEqual(
      expect.objectContaining({ path: '/vercel-blob-client-upload-route' }),
    )
    expect(result.collections?.[0]?.upload).toBe(true)
    // The handler stays in the import map (so dev and prod import maps match),
    // but it is never mounted as an upload provider when the plugin is off.
    expect(
      result.admin?.dependencies?.[
        '@payloadcms/storage-vercel-blob/client#VercelBlobClientUploadHandler'
      ],
    ).toBeDefined()
    expect(result.admin?.components?.providers ?? []).toHaveLength(0)
  })
})
