import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { getPayload } from 'payload'

import { afterEach, describe, expect, it } from 'vitest'

import { clearArchviewTokenCache, type ArchviewSourceCredentials } from '@/utilities/archviewAuth'
import { sampleAllEnabledHosts, sampleOneSource } from '@/utilities/hostSampling'

type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void

const servers: Server[] = []

const startServer = async (handler: Handler): Promise<string> => {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      handler(request, body, response)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

/** Accepts the request and never writes a response: a hung upstream. */
const startHangingServer = (): Promise<string> => startServer(() => {})

const sendTelemetry = (response: ServerResponse): void => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      telemetry: { metrics: { cpuAvg: 7, memoryPercent: 11, loadAvg: 0.2, diskPercent: 33 } },
    }),
  )
}

type PayloadStub = {
  payload: Awaited<ReturnType<typeof getPayload>>
  writes: Array<Record<string, unknown>>
  logs: string[]
  warnings: string[]
}

/**
 * The sampler only needs a query for enabled rows, a create for the sample and
 * a logger. A stub keeps these tests on the timeout behaviour without a
 * database round trip.
 */
const createPayloadStub = (rows: Array<Record<string, unknown>>): PayloadStub => {
  const writes: Array<Record<string, unknown>> = []
  const logs: string[] = []
  const warnings: string[] = []
  const payload = {
    db: { find: async () => ({ docs: rows }) },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      writes.push(data)
      return data
    },
    delete: async () => ({ docs: [] }),
    logger: {
      info: (message: string) => logs.push(message),
      warn: (message: string) => warnings.push(message),
    },
  }
  return { payload: payload as unknown as PayloadStub['payload'], writes, logs, warnings }
}

const credentialsFor = (origin: string, tokenUrl: string): ArchviewSourceCredentials => ({
  audience: `${origin}/api`,
  clientId: 'cms',
  clientSecret: 'test-client-secret',
  origin,
  scope: 'archview:read',
  tokenUrl,
})

afterEach(async () => {
  clearArchviewTokenCache()
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

describe('host sample request budgets', () => {
  it('abandons a source that never answers and sweeps the next source', async () => {
    const hungOrigin = await startHangingServer()
    const healthyOrigin = await startServer((_request, _body, response) => sendTelemetry(response))
    const stub = createPayloadStub([
      { id: 'hung-id', name: 'hung source', origin: hungOrigin, enabled: true },
      { id: 'healthy-id', name: 'healthy source', origin: healthyOrigin, enabled: true },
    ])

    const startedAt = Date.now()
    await sampleAllEnabledHosts(stub.payload, { timeoutMs: 150 })
    const elapsed = Date.now() - startedAt

    // The hung source cost one budget, not the whole sweep.
    expect(elapsed).toBeLessThan(5_000)
    expect(stub.writes.map((row) => row.host)).toEqual(['healthy-id'])
    expect(stub.logs.join('\n')).toContain('host sample: hung source skipped (timeout)')
    expect(stub.logs.join('\n')).toContain('host sample: healthy source fetched')
  })

  it('counts a timed-out source as skipped with reason timeout', async () => {
    const hungOrigin = await startHangingServer()
    const healthyOrigin = await startServer((_request, _body, response) => sendTelemetry(response))
    const stub = createPayloadStub([
      { id: 'hung-id', name: 'hung source', origin: hungOrigin, enabled: true },
      { id: 'healthy-id', name: 'healthy source', origin: healthyOrigin, enabled: true },
    ])

    await sampleAllEnabledHosts(stub.payload, { timeoutMs: 150 })

    expect(stub.logs.join('\n')).toContain(
      'host sampling: 1 written, 1 skipped (1 timeout), 0 failed, 2 sources',
    )
    expect(stub.warnings.join('\n')).toContain('host sampling: skipping hung source: timeout')
  })

  it('treats a token exchange that never answers as a timeout skip', async () => {
    const tokenUrl = await startHangingServer()
    const origin = await startServer((_request, _body, response) => sendTelemetry(response))
    const stub = createPayloadStub([])

    const result = await sampleOneSource(
      stub.payload,
      {
        id: 'token-hang',
        name: 'token hang',
        origin,
        credentials: credentialsFor(origin, tokenUrl),
      },
      // The token budget is the tighter of the two, so it must fire first.
      { timeoutMs: 5_000, tokenTimeoutMs: 150 },
    )

    expect(result).toEqual({ status: 'skipped', reason: 'timeout' })
    expect(stub.logs.join('\n')).toContain('host sample: token hang skipped (timeout)')
    expect(stub.writes).toHaveLength(0)
  })

  it('samples a healthy authenticated source unchanged', async () => {
    let tokenRequests = 0
    const tokenUrl = await startServer((_request, _body, response) => {
      tokenRequests += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }))
    })

    const seenAuthorization: Array<string | undefined> = []
    const origin = await startServer((request, _body, response) => {
      seenAuthorization.push(request.headers.authorization)
      sendTelemetry(response)
    })
    const stub = createPayloadStub([])

    const result = await sampleOneSource(
      stub.payload,
      {
        id: 'healthy-id',
        name: 'healthy source',
        origin,
        project: 'sample-project',
        credentials: credentialsFor(origin, tokenUrl),
      },
      { timeoutMs: 5_000, tokenTimeoutMs: 5_000 },
    )

    expect(result).toEqual({ status: 'written' })
    expect(tokenRequests).toBe(1)
    expect(seenAuthorization).toEqual(['Bearer token-1'])
    expect(stub.writes).toHaveLength(1)
    expect(stub.writes[0]).toMatchObject({ host: 'healthy-id', hostLabel: 'healthy source', cpuAvg: 7 })
  })
})
