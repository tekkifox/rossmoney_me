import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ArchviewAuthConfigError,
  archviewAuthHeadersFor,
  archviewFetch,
  clearArchviewTokenCache,
  type ArchviewEnv,
} from '@/utilities/archviewAuth'
import { ArchviewTokenError, requestClientCredentialsToken } from '@/utilities/archviewToken'

type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void

const servers: Server[] = []

const startServer = async (handler: Handler): Promise<string> => {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      response.setHeader('connection', 'close')
      handler(request, body, response)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

const sendJson = (response: ServerResponse, status: number, payload: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

const envFor = (archviewUrl: string, tokenUrl: string): ArchviewEnv => ({
  ARCHVIEW_CLIENT_ID: 'cms',
  ARCHVIEW_CLIENT_SECRET: 'test-client-secret',
  ARCHVIEW_TOKEN_URL: tokenUrl,
  ARCHVIEW_URL: archviewUrl,
})

afterEach(async () => {
  clearArchviewTokenCache()
  vi.useRealTimers()
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        }),
    ),
  )
})

describe('ArchView token client', () => {
  it('exchanges client credentials once and reuses the token', async () => {
    let tokenRequests = 0
    let tokenRequestBody = ''
    let tokenRequestAuthorization = ''
    const tokenUrl = await startServer((request, body, response) => {
      tokenRequests += 1
      tokenRequestBody = body
      tokenRequestAuthorization = String(request.headers.authorization)
      sendJson(response, 200, { access_token: `token-${tokenRequests}`, expires_in: 3600 })
    })

    const seen: Array<string | undefined> = []
    const archviewUrl = await startServer((request, _body, response) => {
      seen.push(request.headers.authorization)
      sendJson(response, 200, { ok: true })
    })
    const env = envFor(archviewUrl, tokenUrl)

    await archviewFetch(`${archviewUrl}/api/architecture`, { cache: 'no-store' }, env)
    await archviewFetch(`${archviewUrl}/api/system`, { cache: 'no-store' }, env)

    expect(tokenRequests).toBe(1)
    expect(seen).toEqual(['Bearer token-1', 'Bearer token-1'])

    const form = new URLSearchParams(tokenRequestBody)
    expect(form.get('grant_type')).toBe('client_credentials')
    expect(form.get('scope')).toBe('archview:read')
    expect(form.get('audience')).toBe('https://archview.rossmoney.me/api')
    expect(tokenRequestAuthorization).toBe(
      `Basic ${Buffer.from('cms:test-client-secret').toString('base64')}`,
    )
  })

  it('sends ARCHVIEW_AUDIENCE when configured', async () => {
    let tokenRequestBody = ''
    const tokenUrl = await startServer((_request, body, response) => {
      tokenRequestBody = body
      sendJson(response, 200, { access_token: 'audience-token', expires_in: 3600 })
    })
    const archviewUrl = await startServer((_request, _body, response) => {
      sendJson(response, 200, { ok: true })
    })
    const env = {
      ...envFor(archviewUrl, tokenUrl),
      ARCHVIEW_AUDIENCE: 'https://archview.example.test/api',
    }

    await archviewFetch(`${archviewUrl}/api/architecture`, {}, env)

    expect(new URLSearchParams(tokenRequestBody).get('audience')).toBe(
      'https://archview.example.test/api',
    )
  })

  it('renews the token shortly before it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    let tokenRequests = 0
    const tokenUrl = await startServer((_request, _body, response) => {
      tokenRequests += 1
      sendJson(response, 200, { access_token: `token-${tokenRequests}`, expires_in: 120 })
    })
    const archviewUrl = await startServer((_request, _body, response) => {
      sendJson(response, 200, { ok: true })
    })
    const env = envFor(archviewUrl, tokenUrl)

    await archviewFetch(`${archviewUrl}/api/architecture`, {}, env)
    expect(tokenRequests).toBe(1)

    // 120s lifetime renews 12s early, so 100s is still cached.
    vi.setSystemTime(new Date('2026-01-01T00:01:40Z'))
    await archviewFetch(`${archviewUrl}/api/architecture`, {}, env)
    expect(tokenRequests).toBe(1)

    // 109s is inside the renewal window.
    vi.setSystemTime(new Date('2026-01-01T00:01:49Z'))
    const headers = await archviewAuthHeadersFor(`${archviewUrl}/api/architecture`, env)
    expect(headers).toEqual({ Authorization: 'Bearer token-2' })
    expect(tokenRequests).toBe(2)
  })

  it('shares one exchange between concurrent callers', async () => {
    let tokenRequests = 0
    const tokenUrl = await startServer((_request, _body, response) => {
      tokenRequests += 1
      setTimeout(() => {
        sendJson(response, 200, { access_token: `token-${tokenRequests}`, expires_in: 3600 })
      }, 25)
    })
    const archviewUrl = await startServer((_request, _body, response) => {
      sendJson(response, 200, { ok: true })
    })
    const env = envFor(archviewUrl, tokenUrl)

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        archviewFetch(`${archviewUrl}/api/architecture`, {}, env),
      ),
    )

    expect(responses.every((response) => response.ok)).toBe(true)
    expect(tokenRequests).toBe(1)
  })

  it('retries once with a fresh token after a 401', async () => {
    let tokenRequests = 0
    const tokenUrl = await startServer((_request, _body, response) => {
      tokenRequests += 1
      sendJson(response, 200, { access_token: `token-${tokenRequests}`, expires_in: 3600 })
    })

    let archviewRequests = 0
    const seen: Array<string | undefined> = []
    const archviewUrl = await startServer((request, _body, response) => {
      archviewRequests += 1
      seen.push(request.headers.authorization)
      if (archviewRequests === 1) {
        response.setHeader('www-authenticate', 'Bearer error="invalid_token"')
        sendJson(response, 401, { error: 'invalid_token' })
        return
      }
      sendJson(response, 200, { ok: true })
    })
    const env = envFor(archviewUrl, tokenUrl)

    const response = await archviewFetch(`${archviewUrl}/api/architecture`, {}, env)

    expect(response.status).toBe(200)
    expect(archviewRequests).toBe(2)
    expect(tokenRequests).toBe(2)
    expect(seen).toEqual(['Bearer token-1', 'Bearer token-2'])

    // The replacement token is cached for subsequent calls.
    await archviewFetch(`${archviewUrl}/api/architecture`, {}, env)
    expect(archviewRequests).toBe(3)
    expect(tokenRequests).toBe(2)
  })

  it('returns the second 401 instead of retrying forever', async () => {
    let tokenRequests = 0
    const tokenUrl = await startServer((_request, _body, response) => {
      tokenRequests += 1
      sendJson(response, 200, { access_token: `token-${tokenRequests}`, expires_in: 3600 })
    })

    let archviewRequests = 0
    const archviewUrl = await startServer((_request, _body, response) => {
      archviewRequests += 1
      sendJson(response, 401, { error: 'invalid_token' })
    })
    const env = envFor(archviewUrl, tokenUrl)

    const response = await archviewFetch(`${archviewUrl}/api/architecture`, {}, env)

    expect(response.status).toBe(401)
    expect(archviewRequests).toBe(2)
    expect(tokenRequests).toBe(2)
  })
})

describe('ArchView auth configuration', () => {
  it('sends no credential when the client credentials are absent', async () => {
    const seen: Array<string | undefined> = []
    const archviewUrl = await startServer((request, _body, response) => {
      seen.push(request.headers.authorization)
      sendJson(response, 200, { ok: true })
    })

    await archviewFetch(
      `${archviewUrl}/api/architecture`,
      {},
      { ARCHVIEW_URL: archviewUrl, ARCHVIEW_TOKEN_URL: 'http://127.0.0.1:1/token' },
    )

    expect(seen).toEqual([undefined])
  })

  it('rejects partial credentials and a missing token URL', async () => {
    await expect(
      archviewAuthHeadersFor('https://archview.rossmoney.me/api/architecture', {
        ARCHVIEW_CLIENT_ID: 'cms',
        ARCHVIEW_URL: 'https://archview.rossmoney.me',
        ARCHVIEW_TOKEN_URL: 'https://identity.example.test/token',
      }),
    ).rejects.toBeInstanceOf(ArchviewAuthConfigError)

    await expect(
      archviewAuthHeadersFor('https://archview.rossmoney.me/api/architecture', {
        ARCHVIEW_CLIENT_ID: 'cms',
        ARCHVIEW_CLIENT_SECRET: 'secret',
        ARCHVIEW_URL: 'https://archview.rossmoney.me',
      }),
    ).rejects.toThrow(/ARCHVIEW_TOKEN_URL/)
  })

  it('surfaces token endpoint errors without leaking the client secret', async () => {
    const tokenUrl = await startServer((_request, _body, response) => {
      sendJson(response, 400, {
        error: 'invalid_client',
        error_description: 'client authentication failed',
      })
    })
    const archviewUrl = await startServer((_request, _body, response) => {
      sendJson(response, 200, { ok: true })
    })
    const env = envFor(archviewUrl, tokenUrl)

    const error = await archviewFetch(`${archviewUrl}/api/architecture`, {}, env).catch(
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ArchviewTokenError)
    expect((error as ArchviewTokenError).status).toBe(400)
    expect((error as Error).message).toContain('invalid_client')
    expect((error as Error).message).not.toContain('test-client-secret')
  })

  it('propagates token endpoint connection failures', async () => {
    const tokenUrl = await startServer((_request, _body, response) => {
      response.destroy()
    })
    const env = envFor('https://archview.rossmoney.me', tokenUrl)

    const error = await archviewAuthHeadersFor(
      'https://archview.rossmoney.me/api/architecture',
      env,
    ).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/fetch/i)
  })

  it('rejects a token response without an access token', async () => {
    const tokenUrl = await startServer((_request, _body, response) => {
      sendJson(response, 200, { token_type: 'Bearer', expires_in: 3600 })
    })

    await expect(
      requestClientCredentialsToken({
        audience: 'https://archview.rossmoney.me/api',
        clientId: 'cms',
        clientSecret: 'test-client-secret',
        scope: 'archview:read',
        tokenUrl,
      }),
    ).rejects.toThrow(/no access_token/)
  })
})

describe('ArchView origin guard', () => {
  it('attaches the token only to the configured ArchView origin', async () => {
    let tokenRequests = 0
    const tokenUrl = await startServer((_request, _body, response) => {
      tokenRequests += 1
      sendJson(response, 200, { access_token: 'origin-token', expires_in: 3600 })
    })
    const env = envFor('https://archview.rossmoney.me', tokenUrl)

    await expect(
      archviewAuthHeadersFor(
        'https://archview.rossmoney.me/api/architecture?project=image-mosaic',
        env,
      ),
    ).resolves.toEqual({ Authorization: 'Bearer origin-token' })
    expect(tokenRequests).toBe(1)

    await expect(
      archviewAuthHeadersFor('https://archview.vortexservers.co.uk/api/architecture', env),
    ).resolves.toEqual({})
    await expect(
      archviewAuthHeadersFor('https://archview.rossmoney.me.evil.test/api/architecture', env),
    ).resolves.toEqual({})
    await expect(archviewAuthHeadersFor('/api/architecture', env)).resolves.toEqual({})
    expect(tokenRequests).toBe(1)
  })

  it('sends no token to another origin, even when credentials are configured', async () => {
    const seen: Array<string | undefined> = []
    const otherUrl = await startServer((request, _body, response) => {
      seen.push(request.headers.authorization)
      sendJson(response, 200, { ok: true })
    })
    const env = envFor('https://archview.rossmoney.me', 'http://127.0.0.1:1/token')

    await archviewFetch(`${otherUrl}/api/architecture`, {}, env)

    expect(seen).toEqual([undefined])
  })

  it('sends no token when no ArchView URL is configured', async () => {
    const seen: Array<string | undefined> = []
    const archviewUrl = await startServer((request, _body, response) => {
      seen.push(request.headers.authorization)
      sendJson(response, 200, { ok: true })
    })
    const env: ArchviewEnv = {
      ARCHVIEW_CLIENT_ID: 'cms',
      ARCHVIEW_CLIENT_SECRET: 'test-client-secret',
      ARCHVIEW_TOKEN_URL: 'http://127.0.0.1:1/token',
    }

    await archviewFetch(`${archviewUrl}/api/architecture`, {}, env)

    expect(seen).toEqual([undefined])
  })
})
