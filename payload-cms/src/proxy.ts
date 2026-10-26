import { NextResponse, type NextRequest } from 'next/server'

import { shouldDropOriginHeader } from '@/utilities/adminOrigin'

/**
 * Keeps the admin usable on every domain this app is served from.
 *
 * Payload authenticates admin server functions with the session cookie and only
 * trusts an `Origin` header that appears in `config.csrf`. Vercel serves the app
 * from domains a build cannot enumerate (`dev.rossmoney.me`, preview aliases),
 * so those writes were rejected as unauthenticated even though the login had
 * succeeded. For a same-origin request the header carries no CSRF signal, so it
 * is dropped here and Payload falls back to `Sec-Fetch-Site: same-origin`.
 * Cross-origin requests keep their `Origin` and remain subject to the
 * allowlist.
 *
 * @see ../utilities/adminOrigin.ts
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)

  const shouldDrop = shouldDropOriginHeader({
    host: headers.get('x-forwarded-host') ?? headers.get('host'),
    origin: headers.get('origin'),
    protocol: headers.get('x-forwarded-proto') ?? request.nextUrl.protocol,
  })

  if (!shouldDrop) {
    return NextResponse.next()
  }

  headers.delete('origin')

  return NextResponse.next({ request: { headers } })
}

export const config = {
  // Only Payload's own surfaces: the admin UI, admin server functions and the
  // REST/GraphQL API. The public site never needs the session cookie.
  matcher: ['/admin/:path*', '/api/:path*'],
}
