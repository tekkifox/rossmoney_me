import { NextResponse, type NextRequest } from 'next/server'

import { shouldDropOriginHeader } from '@/utilities/adminOrigin'
import {
  buildContentSecurityPolicy,
  createNonce,
} from '@/utilities/contentSecurityPolicy'
import { evaluateDevGate } from '@/utilities/devGate'
import { sanitizeOgParams } from '@/utilities/ogSanitize'
import {
  clientAddress,
  loginRateLimiter,
  ogGlobalRateLimiter,
  ogIpRateLimiter,
} from '@/utilities/rateLimit'
import { getRobotsTag } from '@/utilities/siteURL'
import {
  DRAFT_MODE_COOKIE,
  planPublicRequest,
} from '@/utilities/publicPageCache'

/**
 * Five jobs, all domain-specific:
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
 * before the card route renders them). The per-IP budgets live in MongoDB so
 * every instance shares one counter; if the database is slow or unreachable the
 * limiter falls back to its in-memory budget instead of failing the request.
 *
 * 4. Keep non-canonical deployments out of search results.
 *
 * The same code runs on `www`, on Vercel preview/alias hosts and on `dev`, so a
 * host that is not the public origin answers with `X-Robots-Tag: noindex`. That
 * is a header, not a build flag, so a stale alias cannot advertise itself as
 * indexable even when its environment is production-shaped. The canonical host
 * comes from `utilities/siteURL.ts`, the same helper the metadata and sitemap
 * use.
 *
 * 5. Split draft preview from the cacheable public route.
 *
 * The public pages are prerendered with a revalidation window, so they cannot
 * read `draftMode()` themselves. A request carrying Next.js' draft cookie is
 * rewritten (same URL, same query) to the dynamic renderer under
 * `app/(frontend)/next/draft/`; everything else reaches the cached route. See
 * `utilities/publicPageCache.ts`.
 *
 * 6. Keep the dev preview private.
 *
 * When `DEV_GATE=1` is set on the Vercel preview target, only a client whose
 * address is the WireGuard endpoint's current address (or an address in
 * `DEV_GATE_ALLOW`) may browse the site. Everyone else is redirected to the
 * live home page. `DEV_GATE_ALLOW` also covers automation that cannot use the
 * VPN. `/api`, `/_next`, `/media` and static files are deliberately exempt:
 * the nightly dev sync authenticates against this site's API from another
 * host whose address is not the VPN's, and gating the API would break the
 * refresh and the media backfill. Do not "fix" that by gating everything.
 * See `utilities/devGate.ts`.
 *
 * @see ../utilities/devGate.ts
 * @see ../utilities/publicPageCache.ts
 * @see ../utilities/adminOrigin.ts
 * @see ../utilities/contentSecurityPolicy.ts
 * @see ../utilities/rateLimit.ts
 * @see ../utilities/ogSanitize.ts
 * @see ../utilities/siteURL.ts
 */
export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  const pathname = request.nextUrl.pathname
  let forwarded = false

  // Preview gate, first so an unauthenticated visitor gets one cheap redirect
  // and never reaches the router, the database or the rate limiters. The gate
  // is a no-op unless DEV_GATE is exactly `1`; it also exempts the API, build
  // assets and media internally. See utilities/devGate.ts.
  const devGate = await evaluateDevGate({ headers: request.headers, pathname })
  if (devGate.action === 'redirect') {
    return NextResponse.redirect(devGate.location, devGate.status)
  }

  // The host the browser asked for, after any proxy in front of the app.
  const robotsTag = getRobotsTag(headers.get('x-forwarded-host') ?? headers.get('host'))

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

  // Public pages are prerendered with a revalidation window. The draft-mode
  // cookie is the one thing that must not reach that cached route: when it is
  // present the request is rewritten to a dynamic renderer instead, so editors
  // still see draft content and normal visitors keep the cacheable response.
  const plan = planPublicRequest({
    pathname,
    draftMode: request.cookies.has(DRAFT_MODE_COOKIE),
  })

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
      // A cached public document cannot carry this request's nonce; the static
      // allowlist is the documented fallback. Preview and admin responses are
      // rendered now, so they keep the nonce.
      preRendered: plan.mode === 'public',
    })

    if (plan.mode !== 'public') {
      // Next.js reads this request header to nonce its own script tags. A
      // prerendered document must not receive it: the cached HTML has no nonce,
      // and the response is served with the static allowlist above.
      headers.set('content-security-policy', csp)
      forwarded = true
    }
  }

  // Payload's lockout is per account, so it can be used to deny the single admin
  // service. Bound the attempts from one address as well; the lockout itself is
  // deliberately left untouched.
  if (pathname === '/api/users/login' && request.method === 'POST') {
    const limited = await loginRateLimiter.take(clientAddress(headers))
    if (!limited.allowed) {
      return applyRobotsHeader(tooManyRequests(limited.retryAfter, csp), robotsTag)
    }
  }

  // `/api/og` is public and renders a PNG in Node. Cap the interpolated strings
  // and bound the render rate before the card route runs.
  if (pathname === '/api/og' && request.method === 'GET') {
    const address = clientAddress(headers)
    const perAddress = await ogIpRateLimiter.take(address)
    const perProcess = ogGlobalRateLimiter.take('global')

    if (!perAddress.allowed || !perProcess.allowed) {
      const retryAfter = Math.max(perAddress.retryAfter, perProcess.retryAfter)
      return applyRobotsHeader(tooManyRequests(retryAfter, csp), robotsTag)
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
      return applyRobotsHeader(response, robotsTag)
    }
  }

  const forwardedRequest = forwarded ? { request: { headers } } : undefined

  const response =
    plan.mode === 'preview'
      ? NextResponse.rewrite(previewURL(request, plan.destination), forwardedRequest)
      : NextResponse.next(forwardedRequest)

  if (csp) {
    response.headers.set('Content-Security-Policy', csp)
  }

  return applyRobotsHeader(response, robotsTag)
}

/**
 * Keep the browser URL (and its query string) while rendering the draft
 * document from the preview route.
 */
function previewURL(request: NextRequest, destination: string): URL {
  const url = request.nextUrl.clone()
  url.pathname = destination
  return url
}

/**
 * A deployment served from any host other than the public origin is a preview,
 * alias or dev mirror. Tell crawlers not to index it; canonical URLs still point
 * at the public origin from every deployment.
 */
function applyRobotsHeader(response: NextResponse, robotsTag: string | null): NextResponse {
  if (robotsTag) {
    response.headers.set('X-Robots-Tag', robotsTag)
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
  // `/a` is the first-party Ackee proxy: its responses are scripts and
  // collection API replies from another service, not CMS documents, so they
  // must keep Ackee's own headers rather than this app's CSP.
  matcher: ['/((?!_next/static|_next/image|_vercel|favicon.ico|a(?:/|$)).*)'],
}
