import { NextResponse, type NextRequest } from 'next/server'

import { shouldDropOriginHeader } from '@/utilities/adminOrigin'
import {
  buildContentSecurityPolicy,
  createNonce,
} from '@/utilities/contentSecurityPolicy'

/**
 * Two jobs, both domain-specific:
 *
 * 1. Keep the admin usable on every domain this app is served from.
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
 * 2. Attach a per-request nonce to the Content-Security-Policy.
 *
 * Next.js only adds the nonce to its own scripts when it finds one in the
 * `Content-Security-Policy` request header, so the same value is written to the
 * forwarded request and the response. The policy itself is built in
 * `utilities/contentSecurityPolicy.ts`.
 *
 * @see ../utilities/adminOrigin.ts
 * @see ../utilities/contentSecurityPolicy.ts
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  const pathname = request.nextUrl.pathname
  let forwarded = false

  // Only Payload's own surfaces: the admin UI, admin server functions and the
  // REST/GraphQL API. The public site never needs the session cookie.
  const isPayloadSurface =
    pathname.startsWith('/admin') || pathname.startsWith('/api')

  if (isPayloadSurface) {
    const shouldDrop = shouldDropOriginHeader({
      host: headers.get('x-forwarded-host') ?? headers.get('host'),
      origin: headers.get('origin'),
      protocol: headers.get('x-forwarded-proto') ?? request.nextUrl.protocol,
    })

    if (shouldDrop) {
      headers.delete('origin')
      forwarded = true
    }
  }

  let csp: string | null = null

  // `next dev` uses eval and a WebSocket for HMR, so a production policy would
  // break the development server and the Playwright suite that starts it. The
  // strict policy is therefore production-only; `next start` and both hosted
  // surfaces run with NODE_ENV=production.
  if (process.env.NODE_ENV === 'production') {
    const nonce = createNonce()
    const protocol = (
      headers.get('x-forwarded-proto') ?? request.nextUrl.protocol
    )
      .split(',')[0]
      .trim()
      .replace(/:$/, '')
      .toLowerCase()

    csp = buildContentSecurityPolicy({
      nonce,
      isHttps: protocol === 'https',
      isAdmin: pathname.startsWith('/admin'),
    })

    // Next.js reads this request header to nonce its own script tags.
    headers.set('content-security-policy', csp)
    forwarded = true
  }

  const response = forwarded
    ? NextResponse.next({ request: { headers } })
    : NextResponse.next()

  if (csp) {
    response.headers.set('Content-Security-Policy', csp)
  }

  return response
}

export const config = {
  // Every document and API response, but not immutable build assets or the
  // image optimiser (which sets its own restrictive CSP for SVG safety).
  matcher: ['/((?!_next/static|_next/image|_vercel|favicon.ico).*)'],
}
