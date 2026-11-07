import { describe, expect, it } from 'vitest'

import { loadArchitectureSnapshot } from '@/utilities/architectureSnapshot'
import type { ArchviewEnv } from '@/utilities/archviewAuth'

/**
 * Opt-in live check against a real ArchView deployment.
 *
 * `ARCHVIEW_LIVE_URL` is the instance root. When it is unset this file is
 * skipped, so `pnpm test:int` and the pull-request pipeline stay offline.
 * Credentials are optional and use their own `ARCHVIEW_LIVE_*` names so a
 * developer's normal `ARCHVIEW_*` app configuration cannot turn the live test
 * on by accident. Values are read from the environment only: this file must
 * never contain a real hostname, client id or secret.
 */
const readEnv = (name: string): string | undefined => {
  const value = process.env[name]
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

const liveURL = readEnv('ARCHVIEW_LIVE_URL')

/**
 * Maps the live test's variables onto the names the app's client uses.
 *
 * Partial credentials are a configuration error rather than an anonymous
 * request: silently sending no token would surface as a confusing `401`.
 */
const liveEnv = (): ArchviewEnv => {
  const clientId = readEnv('ARCHVIEW_LIVE_CLIENT_ID')
  const clientSecret = readEnv('ARCHVIEW_LIVE_CLIENT_SECRET')
  const tokenUrl = readEnv('ARCHVIEW_LIVE_TOKEN_URL')
  const audience = readEnv('ARCHVIEW_LIVE_AUDIENCE')
  const scope = readEnv('ARCHVIEW_LIVE_SCOPE')

  if (clientId || clientSecret || tokenUrl) {
    if (!clientId || !clientSecret || !tokenUrl) {
      throw new Error(
        'ARCHVIEW_LIVE_CLIENT_ID, ARCHVIEW_LIVE_CLIENT_SECRET and ARCHVIEW_LIVE_TOKEN_URL must be set together.',
      )
    }
  }

  return {
    ARCHVIEW_URL: liveURL,
    ...(clientId ? { ARCHVIEW_CLIENT_ID: clientId } : {}),
    ...(clientSecret ? { ARCHVIEW_CLIENT_SECRET: clientSecret } : {}),
    ...(tokenUrl ? { ARCHVIEW_TOKEN_URL: tokenUrl } : {}),
    ...(audience ? { ARCHVIEW_AUDIENCE: audience } : {}),
    ...(scope ? { ARCHVIEW_SCOPE: scope } : {}),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

describe.skipIf(!liveURL)('live ArchView instance', () => {
  it('returns the snapshot shape the architecture templates render', async () => {
    // The same client the page templates call, including the OAuth
    // client-credentials exchange when credentials are configured. The page
    // names the live instance, as an editor can. `payload: null` keeps the test
    // out of the database: a live check must not write the snapshot cache.
    const snapshot = await loadArchitectureSnapshot(
      { archviewUrl: liveURL },
      {},
      {
        payload: null,
        env: liveEnv(),
        label: 'live integration',
      },
    )

    expect(snapshot).not.toBeNull()
    expect(isRecord(snapshot)).toBe(true)

    const body = snapshot as Record<string, unknown>

    for (const key of [
      'cluster',
      'docker',
      'endpoints',
      'nodes',
      'services',
      'status',
      'telemetry',
      'updatedAt',
    ]) {
      expect(body).toHaveProperty(key)
    }

    expect(isRecord(body.docker)).toBe(true)
    expect(isRecord(body.telemetry)).toBe(true)
    expect(Array.isArray(body.endpoints)).toBe(true)

    expect(Array.isArray(body.nodes)).toBe(true)
    expect((body.nodes as unknown[]).length).toBeGreaterThan(0)

    expect(Array.isArray(body.services)).toBe(true)
    expect((body.services as unknown[]).length).toBeGreaterThan(0)

    expect(Number.isNaN(Date.parse(String(body.updatedAt)))).toBe(false)
  })
})
