import { randomBytes } from 'node:crypto'

import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import {
  createArchitectureGet,
  resolveArchviewRequestSource,
} from '@/app/api/architecture/route'
import {
  clearArchviewTokenCache,
  type ArchviewSourceCredentials,
} from '@/utilities/archviewAuth'
import { findEnabledArchviewSource } from '@/utilities/archviewSources'
import {
  decryptArchviewSecret,
  encryptArchviewSecret,
} from '@/utilities/archviewSourceSecret'

const KEY = randomBytes(32).toString('base64')
const WRONG_KEY = randomBytes(32).toString('base64')
const runId = randomBytes(4).toString('hex')

const secretEnv = { ARCHVIEW_SECRET_KEY: KEY }

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('ArchView source secret encryption', () => {
  it('stores ciphertext that differs from the plaintext and decrypts back to it', () => {
    const plaintext = 'super-secret-client-value'
    const ciphertext = encryptArchviewSecret(plaintext, secretEnv)

    expect(ciphertext).not.toContain(plaintext)
    expect(ciphertext).toMatch(/^v1\./)
    expect(decryptArchviewSecret(ciphertext, secretEnv)).toBe(plaintext)
  })

  it('uses a fresh IV for every value', () => {
    const plaintext = 'same-value'
    const first = encryptArchviewSecret(plaintext, secretEnv)
    const second = encryptArchviewSecret(plaintext, secretEnv)

    expect(first).not.toBe(second)
    expect(decryptArchviewSecret(first, secretEnv)).toBe(plaintext)
    expect(decryptArchviewSecret(second, secretEnv)).toBe(plaintext)
  })

  it('fails to decrypt with a different key', () => {
    const ciphertext = encryptArchviewSecret('rotate-me', secretEnv)

    expect(() =>
      decryptArchviewSecret(ciphertext, { ARCHVIEW_SECRET_KEY: WRONG_KEY }),
    ).toThrow(/ARCHVIEW_SECRET_KEY/)
  })

  it('refuses to store or read a secret without ARCHVIEW_SECRET_KEY', () => {
    const ciphertext = encryptArchviewSecret('value', secretEnv)

    expect(() => encryptArchviewSecret('value', {})).toThrow(/ARCHVIEW_SECRET_KEY/)
    expect(() => decryptArchviewSecret(ciphertext, {})).toThrow(/ARCHVIEW_SECRET_KEY/)
  })

  it('rejects a key that is not 32 base64-encoded bytes', () => {
    expect(() =>
      encryptArchviewSecret('value', { ARCHVIEW_SECRET_KEY: 'dG9vLXNob3J0' }),
    ).toThrow(/32 bytes/)
  })
})

describe('ArchView sources collection', () => {
  let payload: Payload
  const previousKey = process.env.ARCHVIEW_SECRET_KEY
  const adminEmail = `archview-sources-${runId}@example.test`

  const sourceData = (
    suffix: string,
    overrides: Partial<RequiredDataFromCollectionSlug<'archview-sources'>> = {},
  ): RequiredDataFromCollectionSlug<'archview-sources'> => ({
    name: `source-${runId}-${suffix}`,
    origin: `https://${suffix}.example.test`,
    audience: `https://${suffix}.example.test/api`,
    tokenUrl: 'https://identity.example.test/oauth/token',
    clientId: `cms-${suffix}`,
    clientSecret: `secret-${suffix}`,
    scope: 'archview:read',
    enabled: true,
    ...overrides,
  })

  beforeAll(async () => {
    process.env.ARCHVIEW_SECRET_KEY = KEY
    payload = await getPayload({ config: await config })
  })

  afterAll(() => {
    if (previousKey === undefined) {
      delete process.env.ARCHVIEW_SECRET_KEY
    } else {
      process.env.ARCHVIEW_SECRET_KEY = previousKey
    }
  })

  afterEach(() => {
    clearArchviewTokenCache()
  })

  it('stores the client secret encrypted in the database', async () => {
    const data = sourceData('encrypted')
    await payload.create({
      collection: 'archview-sources',
      data,
      overrideAccess: true,
    })

    const raw = await payload.db.findOne<{ id: string; clientSecret?: string }>({
      collection: 'archview-sources',
      where: { name: { equals: data.name } },
    })

    expect(raw?.clientSecret).toBeDefined()
    expect(raw?.clientSecret).not.toBe(data.clientSecret)
    expect(raw?.clientSecret).toMatch(/^v1\./)
  })

  it('never includes the secret in a collection API response', async () => {
    const data = sourceData('hidden')
    const created = await payload.create({
      collection: 'archview-sources',
      data,
      overrideAccess: true,
    })
    const admin = await payload.create({
      collection: 'users',
      data: { email: adminEmail, password: 'test-password-123' },
      overrideAccess: true,
    })

    const result = await payload.find({
      collection: 'archview-sources',
      overrideAccess: false,
      user: admin,
      where: { id: { equals: created.id } },
    })

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]).not.toHaveProperty('clientSecret')
    expect(JSON.stringify(result.docs[0])).not.toContain('secret-hidden')
  })

  it('resolves an enabled source with its decrypted secret', async () => {
    const data = sourceData('enabled')
    await payload.create({
      collection: 'archview-sources',
      data,
      overrideAccess: true,
    })

    const credentials = await findEnabledArchviewSource(
      payload,
      data.origin,
    )

    expect(credentials).toMatchObject({
      origin: data.origin,
      audience: data.audience,
      tokenUrl: data.tokenUrl,
      clientId: data.clientId,
      scope: 'archview:read',
    })
    expect(credentials?.clientSecret).toBe(data.clientSecret)
  })

  it('rejects a disabled source and an unknown origin', async () => {
    const data = sourceData('disabled', { enabled: false })
    await payload.create({
      collection: 'archview-sources',
      data,
      overrideAccess: true,
    })

    expect(
      await findEnabledArchviewSource(payload, data.origin),
    ).toBeNull()
    expect(
      await findEnabledArchviewSource(payload, 'https://unknown.example.test'),
    ).toBeNull()
  })

  it('resolves an enabled row through the request resolver', async () => {
    const data = sourceData('resolver')
    await payload.create({
      collection: 'archview-sources',
      data,
      overrideAccess: true,
    })
    const env = { ARCHVIEW_URL: 'https://default.example.test' }
    const lookupSource = (origin: string) => findEnabledArchviewSource(payload, origin)

    await expect(
      resolveArchviewRequestSource(data.origin, { env, lookupSource }),
    ).resolves.toMatchObject({
      origin: data.origin,
      credentials: { origin: data.origin, clientId: data.clientId },
    })

    await expect(
      resolveArchviewRequestSource('https://unknown.example.test', {
        env,
        lookupSource,
      }),
    ).resolves.toBeNull()
  })
})

describe('architecture proxy source credentials', () => {
  const sourceOne: ArchviewSourceCredentials = {
    origin: 'https://archview.one.example',
    audience: 'https://archview.one.example/api',
    tokenUrl: 'https://identity.one.example/oauth/token',
    clientId: 'cms-one',
    clientSecret: 'secret-one',
    scope: 'archview:read',
  }
  const sourceTwo: ArchviewSourceCredentials = {
    ...sourceOne,
    origin: 'https://archview.two.example',
    audience: 'https://archview.two.example/api',
    tokenUrl: 'https://identity.two.example/oauth/token',
    clientId: 'cms-two',
    clientSecret: 'secret-two',
  }

  type Call = { authorization: string | null; url: string }

  const installFetch = (options: { rejectFirstSourceCall?: boolean } = {}) => {
    const calls: Call[] = []
    let tokenRequests = 0
    let sourceCalls = 0

    const fetchImpl: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      calls.push({ url, authorization: new Headers(init?.headers).get('authorization') })

      if (url.startsWith('https://identity.one.example/') || url.startsWith('https://identity.two.example/')) {
        tokenRequests += 1
        return jsonResponse({ access_token: `token-${tokenRequests}`, expires_in: 3600 })
      }
      if (url.startsWith('https://identity.default.example/')) {
        return jsonResponse({ access_token: 'default-token', expires_in: 3600 })
      }
      if (url.startsWith(sourceOne.origin)) {
        sourceCalls += 1
        if (options.rejectFirstSourceCall && sourceCalls === 1) {
          return jsonResponse({ error: 'invalid_token' }, 401)
        }
        return jsonResponse({ title: 'one' })
      }
      if (url.startsWith(sourceTwo.origin)) {
        return jsonResponse({ title: 'two' })
      }
      if (url.startsWith('https://archview.anonymous.example')) {
        return jsonResponse({ title: 'anonymous' })
      }
      if (url.startsWith('https://default.example.test')) {
        return jsonResponse({ title: 'default' })
      }
      return new Response('not found', { status: 404 })
    }

    return { calls, fetchImpl }
  }

  const env = {
    ARCHVIEW_URL: 'https://default.example.test',
    ARCHVIEW_CLIENT_ID: 'cms-default',
    ARCHVIEW_CLIENT_SECRET: 'secret-default',
    ARCHVIEW_TOKEN_URL: 'https://identity.default.example/oauth/token',
    ARCHVIEW_AUDIENCE: 'https://default.example.test/api',
    ARCHVIEW_ALLOWED_SOURCES: 'https://archview.anonymous.example',
  }

  const architectureCalls = (calls: Call[]) =>
    calls.filter((call) => call.url.includes('/api/architecture'))

  afterEach(() => {
    clearArchviewTokenCache()
  })

  it('attaches a source token to that source origin and strips source', async () => {
    const { calls, fetchImpl } = installFetch()
    const GET = createArchitectureGet({
      env,
      fetchImpl,
      lookupSource: async (origin) => (origin === sourceOne.origin ? sourceOne : null),
    })

    const response = await GET(
      new Request(
        'https://cms.example/api/architecture?source=https%3A%2F%2Farchview.one.example&project=image-mosaic',
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ title: 'one' })

    const requests = architectureCalls(calls)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(
      'https://archview.one.example/api/architecture?project=image-mosaic',
    )
    expect(requests[0].authorization).toBe('Bearer token-1')
  })

  it('never reuses one source token for another source', async () => {
    const { calls, fetchImpl } = installFetch()
    const sources = new Map([
      [sourceOne.origin, sourceOne],
      [sourceTwo.origin, sourceTwo],
    ])
    const GET = createArchitectureGet({
      env,
      fetchImpl,
      lookupSource: async (origin) => sources.get(origin) ?? null,
    })

    await GET(
      new Request(
        `https://cms.example/api/architecture?source=${encodeURIComponent(sourceOne.origin)}`,
      ),
    )
    await GET(
      new Request(
        `https://cms.example/api/architecture?source=${encodeURIComponent(sourceTwo.origin)}`,
      ),
    )

    const requests = architectureCalls(calls)
    expect(requests.map((call) => [call.url, call.authorization])).toEqual([
      [`${sourceOne.origin}/api/architecture`, 'Bearer token-1'],
      [`${sourceTwo.origin}/api/architecture`, 'Bearer token-2'],
    ])
  })

  it('retries once with a fresh source token after a 401', async () => {
    const { calls, fetchImpl } = installFetch({ rejectFirstSourceCall: true })
    const GET = createArchitectureGet({
      env,
      fetchImpl,
      lookupSource: async (origin) => (origin === sourceOne.origin ? sourceOne : null),
    })

    const response = await GET(
      new Request(
        `https://cms.example/api/architecture?source=${encodeURIComponent(sourceOne.origin)}`,
      ),
    )

    expect(response.status).toBe(200)
    const requests = architectureCalls(calls)
    expect(requests.map((call) => call.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ])
  })

  it('sends no credential to an allowlisted anonymous source', async () => {
    const { calls, fetchImpl } = installFetch()
    const GET = createArchitectureGet({
      env,
      fetchImpl,
      lookupSource: async () => null,
    })

    const response = await GET(
      new Request(
        'https://cms.example/api/architecture?source=https%3A%2F%2Farchview.anonymous.example',
      ),
    )

    expect(response.status).toBe(200)
    const requests = architectureCalls(calls)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://archview.anonymous.example/api/architecture')
    expect(requests[0].authorization).toBeNull()
  })

  it('falls back to the configured deployment for a disabled or unknown source', async () => {
    const { calls, fetchImpl } = installFetch()
    const GET = createArchitectureGet({
      env,
      fetchImpl,
      lookupSource: async () => null,
    })

    const response = await GET(
      new Request(
        'https://cms.example/api/architecture?source=https%3A%2F%2Fdisabled.example.test',
      ),
    )

    expect(response.status).toBe(200)
    const requests = architectureCalls(calls)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://default.example.test/api/architecture')
    expect(requests[0].authorization).toBe('Bearer default-token')
  })
})
