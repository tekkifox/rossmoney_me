# Application hardening — rossmoney.me — 2026-10-26

Follow-up to [`audit-2026-10-26.md`](./audit-2026-10-26.md). The dependency half
(Next.js 16.4.3, Payload/`@payloadcms/*` 3.90.2, sharp 0.35.5) is a separate
merged change. This record covers the application half and the decisions the
audit left open.

The branch already contains `origin/dev`'s Payload Live Preview framing fix
(`frame-src 'self'` on the admin, `frame-ancestors 'self'` on public pages); it
is retained and the `X-Frame-Options` values are aligned to it below.

## Decisions and changes

| # | Finding | Outcome |
| --- | --- | --- |
| 1 | `/api/og` public and unhardened | **Fixed.** `utilities/ogSanitize.ts` caps `title`/`leader` at 100 and `description` at 200 code points, strips C0/C1, bidi and zero-width characters, and trims. `utilities/rateLimit.ts` adds 30 renders per IP per minute and 300 per process per minute. The route stays public. The only cacheable `/api` exception is this deterministic image, cached for a day. |
| 2 | Session cookie not `Secure` | **Fixed.** `Users.auth.cookies.secure` is derived by `sessionCookieIsSecure()`: HTTPS `SERVER_URL`/`NEXT_PUBLIC_SERVER_URL` in production, or any Vercel deployment; always false in development and for a local production build over HTTP. |
| 3 | No login rate limit | **Fixed at the app edge.** `/api/users/login` gets ten attempts per IP per ten minutes in `proxy.ts`. Payload's per-account lockout (5 failures / 10 minutes) is untouched. The `Origin`-dropping branch for same-origin admin writes runs before the limiter and is unchanged. |
| 4 | HSTS mismatch | **Fixed in the app.** Every response now emits `max-age=63072000; includeSubDomains; preload`, the Vercel production value, on both the Vercel and Nginx Proxy Manager surfaces. The Nginx Proxy Manager proxy-host configuration is not in this repository; it must not add a second `Strict-Transport-Security` header. |
| 5 | `X-Powered-By` advertises the stack | **Fixed.** `poweredByHeader: false` stops Next.js and prevents `withPayload` from adding `Next.js, Payload`. Verified absent. |
| 6 | `/api/*` cache policy | **Fixed.** `/api/:path*` defaults to `private, no-store`. The named exception is `/api/og`, deliberately `public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800`. |
| 7 | Anonymous `/api/access` and `/api/users/init` | **Declined (kept closed).** Anonymous `/api/access` is `401`; anonymous `/api/users/init` is `404`. The public site never requests either endpoint, the admin bootstrap has a session, and the schema/initialised state is unnecessary metadata. Authenticated administrators still receive the real permissions and `{"initialized":true}`. |
| 8 | No `security.txt` | **Fixed.** `public/.well-known/security.txt`, `Contact: mailto:dev@example.com`. That address is the app's existing public contact (`contact-page` seed, form recipient and `EMAIL_FROM` fallback), not an invented one. |
| 9 | Internal `http://socket-proxy:2375` in page data | **Fixed.** The ArchView payload is redacted server-side in `/api/architecture`, server-side in the game-servers/travelling templates, and client-side before the DOM is written. Internal or non-HTTPS ArchView values now fall back to the same-origin `/api/architecture` proxy instead of being rendered into `data-architecture-api`/the meta tag. Verified response and rendered DOM contain `[internal]`, not the endpoint URL. |
| 10 | Analytics pageview beacon not observed | **Declined (no CSP change).** The Vercel Web Analytics SDK deliberately no-ops when `navigator.webdriver` is true or the user agent contains `Headless`; that is why an automated/headless audit sees no beacon. With those automation markers removed, the live site sends `POST /<deployment-hash>/view` → `202` with zero CSP violations. The CSP was not weakened. |
| 11 | `X-Frame-Options` versus `frame-ancestors` | **Fixed.** Public pages are `SAMEORIGIN` so Live Preview can frame them; the admin path is still `DENY`. Verified on `/admin`, `/admin/login` and `/admin/collections/pages`; the public page is `SAMEORIGIN`. |
| 12 | Do not duplicate CSP logic | **Kept.** `utilities/contentSecurityPolicy.ts` remains the only builder; `next.config.ts` still emits no CSP. |

## Verification performed

Production build (`next build` + `next start`) on a disposable database:

- `pnpm build`, `pnpm lint`, `pnpm lint:tokens`, `pnpm test:int` (89 tests) pass.
- The repository's four Playwright `test:e2e` specs pass against the same
  production server on port 3100. The literal `pnpm test:e2e` script could not
  use its hard-coded port 3000 because another worktree held it; the specs were
  run unmodified except for the base port.
- Browser pass with a `securitypolicyviolation` listener: zero violations on
  `/`, `/cv` and `/admin/login`, through admin login, a page edit and save, and
  Payload Live Preview rendering the page inside the admin iframe.
- The save was a real `PATCH /api/pages/:id` → `200`; the title was read back
  after a reload and then restored. Live Preview rendered `/cv` with no
  violations. The admin was loaded on a non-allowlisted same-origin host to
  exercise the `Origin`-drop path.
- Rate limit: `/api/og` returned `404` (see below) for 30 requests and `429`
  with `Retry-After: 60` on the 31st; `/api/users/login` returned `401` ten
  times and `429` with `Retry-After: 600` on the 11th. A separate test account
  still received Payload's lockout message on the sixth bad password.
- `/api/og` sanitisation: a 300-character `description` arrived at the route as
  a 200-character `x-middleware-rewrite`, with control characters removed.
- Cookie: a production server with an HTTPS `SERVER_URL` returned
  `Set-Cookie: payload-token=...; Path=/; Secure=true; HttpOnly=true; SameSite=Lax`.

### Headers, before (deployed base) and after (this branch, local production)

| Endpoint | Before | After |
| --- | --- | --- |
| `/` | `X-Frame-Options: DENY`, `X-Powered-By: Next.js, Payload`, HSTS present | `X-Frame-Options: SAMEORIGIN`, no `X-Powered-By`, same HSTS |
| `/api/access` | `200` schema, `Cache-Control: public, max-age=0, must-revalidate`, `X-Powered-By` | `401` anonymous, `Cache-Control: private, no-store`, no `X-Powered-By` |
| `/api/users/login` | `Cache-Control: public, max-age=0, must-revalidate`, `X-Powered-By` | `Cache-Control: private, no-store`, no `X-Powered-By`, 10/IP/10 min limit |
| `/api/og` | `200 image/png`, `Cache-Control: public, max-age=0, must-revalidate`, `X-Powered-By` | `Cache-Control: public, max-age=86400, ...`, sanitised query, rate limited, no `X-Powered-By` |

## What was not verified

- **Deployment of this branch.** The header/browser evidence is from a local
  production build. The deployed Vercel and Nginx Proxy Manager surfaces were
  only read for the "before" column.
- **Nginx Proxy Manager proxy-host configuration.** It is not in this
  repository. The app now emits the aligned HSTS value; the edge must be
  confirmed not to add its own.
- **`/api/og` on the standalone/Portainer surface.** It still returns Payload's
  `404 {"message":"Route not found \"/api/og\""}` there, the same pre-existing
  registration difference the audit recorded. On Vercel the route is present;
  the proxy hardening applies before it either way. Sanitisation and the rate
  limit were verified through the proxy rewrite and status codes locally.
- **Live Preview on the Vercel surface.** It was verified on the local
  production build, not on a deployed preview.
- **A headed, non-automated browser for analytics.** The live beacon was
  reproduced with a real Chromium in which only the automation markers were
  removed. An actual headed browser could not be launched in this environment.
- **HSTS preload list submission.** The header is now eligible
  (`includeSubDomains; preload`); actually submitting `example.com` is a
  separate product/deployment decision.
