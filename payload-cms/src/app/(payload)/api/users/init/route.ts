import configPromise from '@payload-config'
import { getPayload } from 'payload'

/**
 * Payload exposes `GET /api/users/init` so a client can tell whether the first
 * user exists. The admin's first-user flow does not use it (it posts to
 * `first-register`), and on every deployed database the answer is already
 * `true`, so anonymous callers learn nothing they need.
 *
 * Return 404 to anonymous requests rather than confirming the state, and keep
 * the real answer available to an authenticated administrator.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const payload = await getPayload({ config: configPromise })
  const { responseHeaders, user } = await payload.auth({
    canSetHeaders: true,
    headers: request.headers,
  })

  const headers = new Headers({
    'Cache-Control': 'private, no-store',
  })
  responseHeaders?.forEach((value, key) => headers.append(key, value))

  if (!user) {
    return Response.json({ errors: [{ message: 'Not found' }] }, { status: 404, headers })
  }

  const users = await payload.count({ collection: 'users' })

  return Response.json({ initialized: users.totalDocs > 0 }, { headers })
}
