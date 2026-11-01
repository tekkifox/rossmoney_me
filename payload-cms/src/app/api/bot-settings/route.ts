import config from '@payload-config'
import { getPayload, type Payload } from 'payload'

import { toBotSettingsResponse } from '@/utilities/botSettings'

export const runtime = 'nodejs'
// The bot polls this after an editor saves; never serve it from a cache.
export const dynamic = 'force-dynamic'

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

export type BotSettingsRouteDeps = {
  loadPayload?: () => Promise<Payload>
}

/**
 * `GET /api/bot-settings` — the read path the notification bot uses.
 *
 * Read-only and authenticated: a Payload API key on a dedicated user is sent as
 * `Authorization: users API-Key <key>` (an admin session is accepted too).
 * Anything else gets 401; there is no anonymous path to the same data.
 *
 * The response is shaped like the agent's old `NOTIFY_TARGETS` variable:
 * `targets` keyed by name, snake_case fields, `bookstack` nested. It contains
 * the NAME of each BookStack credential and never a token.
 */
export function createBotSettingsGet(deps: BotSettingsRouteDeps = {}) {
  const loadPayload = deps.loadPayload ?? (async () => getPayload({ config: await config }))

  return async function GET(request: Request): Promise<Response> {
    const payload = await loadPayload()

    const auth = await payload
      .auth({ headers: request.headers })
      .catch(() => ({ user: null }))

    if (!auth.user) {
      return json({ errors: [{ message: 'Unauthorized' }] }, 401)
    }

    let doc: unknown
    try {
      doc = await payload.findGlobal({ slug: 'bot-settings', depth: 0, overrideAccess: true })
    } catch (error) {
      payload.logger?.error(
        `Bot settings could not be read: ${error instanceof Error ? error.message : String(error)}`,
      )
      return json({ errors: [{ message: 'Bot settings are unavailable.' }] }, 500)
    }

    const body = toBotSettingsResponse(doc)
    if (!body) {
      return json({ errors: [{ message: 'Bot settings have not been configured.' }] }, 404)
    }

    return json(body, 200)
  }
}

export const GET = createBotSettingsGet()
