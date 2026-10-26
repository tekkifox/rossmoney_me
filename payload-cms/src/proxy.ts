import { NextResponse, type NextRequest } from 'next/server'

import { shouldDropOriginHeader } from '@/utilities/adminOrigin'
import {
  buildContentSecurityPolicy,
  createNonce,
} from '@/utilities/contentSecurityPolicy'
import { sanitizeOgParams } from '@/utilities/ogSanitize'
import {
  clientAddress,
  loginRateLimiter,
  ogGlobalRateLimiter,
  ogIpRateLimiter,
} from '@/utilities/rateLimit'

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
 * 3. Put a cheap application-level guard in front of the two expensive public
 * endpoints: the login handler (Payload's account lockout alone lets one source
 * keep the only admin locked out) and the Open Graph image renderer (the
 * query-string values are rewritten to bounded, control-character-free input
 * before Payload's generator sees them).
 *
 * @see ../utilities/adminOrigin.ts
 * @see ../utilities/contentSecurityPolicy.ts
 * @see ../utilities/rateLimit.ts
 * @see ../utilities/ogSanitize.ts
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

  // Payload's lockout is per account, so it can be used to deny the single admin
  // service. Bound the attempts from one address as well; the lockout itself is
  // deliberately left untouched.
  if (pathname === '/api/users/login' && request.method === 'POST') {
    const limited = loginRateLimiter.take(clientAddress(headers))
    if (!limited.allowed) {
      return tooManyRequests(limited.retryAfter, csp)
    }
  }

  // `/api/og` is public and renders a PNG in Node. Cap the interpolated strings
  // and bound the render rate before the generated Payload route runs.
  if (pathname === '/api/og' && request.method === 'GET') {
    const address = clientAddress(headers)
    const perAddress = ogIpRateLimiter.take(address)
    const perProcess = ogGlobalRateLimiter.take('global')

    if (!perAddress.allowed || !perProcess.allowed) {
      const retryAfter = Math.max(perAddress.retryAfter, perProcess.retryAfter)
      return tooManyRequests(retryAfter, csp)
    }

    const ogUrl = request.nextUrl.clone()
    const { params, changed } = sanitizeOgParams(ogUrl.searchParams)

    if (changed) {
      for (const [name, value] of Object.entries(params)) {
        if (value !== undefined) {
          ogUrl.searchParams.set(name, value)
        }
      }

      const response = NextResponse.rewrite(ogUrl, { request: { headers } })
      if (csp) {
        response.headers.set('Content-Security-Policy', csp)
      }
      return response
    }
  }

  const response = forwarded
    ? NextResponse.next({ request: { headers } })
    : NextResponse.next()

  if (csp) {
    response.headers.set('Content-Security-Policy', csp)
  }

  return response
}

function tooManyRequests(retryAfter: number, csp: string | null): NextResponse {
  const response = NextResponse.json(
    { errors: [{ message: 'Too many requests. Try again later.' }] },
    {
      status: 429,
      headers: {
        'Cache-Control': 'private, no-store',
        'Retry-After': String(Math.max(1, retryAfter)),
      },
    },
  )

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
