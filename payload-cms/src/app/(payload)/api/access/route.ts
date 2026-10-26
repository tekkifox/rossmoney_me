import configPromise from '@payload-config'
import { getPayload } from 'payload'

/**
 * Payload's generated `/api/access` endpoint answers anonymous callers with the
 * full collection/field schema and read permissions. The public site never
 * requests it; only the admin bootstrap does, after a session exists.
 *
 * This explicit route wins over the `[...slug]` catch-all. It returns the same
 * sanitized permissions payload Payload would for a signed-in user and refuses
 * anonymous requests instead of disclosing the schema.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const payload = await getPayload({ config: configPromise })
  const { permissions, responseHeaders, user } = await payload.auth({
    canSetHeaders: true,
    headers: request.headers,
  })

  const headers = new Headers({
    'Cache-Control': 'private, no-store',
  })
  responseHeaders?.forEach((value, key) => headers.append(key, value))

  if (!user) {
    return Response.json(
      { errors: [{ message: 'Unauthorized' }] },
      { status: 401, headers },
    )
  }

  return Response.json(permissions, { headers })
}
