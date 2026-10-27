import { VERCEL_BLOB_API_ORIGIN } from '../../../src/utilities/contentSecurityPolicy'
import { cspDirective, expect, expectCspHeader, test } from '../support/csp'

/**
 * The regression this suite exists to prevent: preview-only sources leaking
 * into a production (non-Vercel) policy, and inline stylesheet text being
 * allowed on public pages.
 *
 * This build has no Vercel environment. If the public CSP gains any of these
 * strings, either the deployment detection in `contentSecurityPolicy.ts` is
 * wrong or a source was added without a documented reason.
 */
const VERCEL_TOOLBAR_SOURCES = [
  'https://vercel.live',
  'wss://ws-us3.pusher.com',
  'https://assets.vercel.com',
  'https://vercel.com',
]

/**
 * `https://vercel.com` is deliberately allowed in the *admin* `connect-src`
 * for Vercel Blob browser uploads (see the `VERCEL_BLOB_API_ORIGIN` comment in
 * `contentSecurityPolicy.ts`). That is unrelated to the Toolbar, so the admin
 * check below asserts the three Toolbar-only hosts are absent and pins the
 * Blob API origin to `connect-src` alone. The public policy must still exclude
 * all four Toolbar sources.
 */
const VERCEL_TOOLBAR_ONLY_SOURCES = [
  'https://vercel.live',
  'wss://ws-us3.pusher.com',
  'https://assets.vercel.com',
]

test('production public CSP does not grant the Vercel Toolbar sources', async ({ page }) => {
  expect(
    process.env.VERCEL_ENV,
    'This suite must run against a build with no Vercel environment',
  ).toBeUndefined()
  expect(
    process.env.VERCEL,
    'This suite must run against a build with no Vercel environment',
  ).toBeUndefined()

  const response = await page.goto('/')
  const csp = expectCspHeader(response)

  for (const source of VERCEL_TOOLBAR_SOURCES) {
    expect(csp, `production public CSP must not contain ${source}`).not.toContain(source)
  }

  expect(cspDirective(csp, 'style-src-elem')).toBe("style-src-elem 'self'")
})

test('admin CSP keeps the Vercel Toolbar out and scopes the Blob API to connect-src', async ({
  page,
}) => {
  const response = await page.goto('/admin/login')
  const csp = expectCspHeader(response, { admin: true })

  for (const source of VERCEL_TOOLBAR_ONLY_SOURCES) {
    expect(csp, `admin CSP must not contain ${source}`).not.toContain(source)
  }

  const connect = cspDirective(csp, 'connect-src') ?? ''
  expect(connect.split(/\s+/)).toContain(VERCEL_BLOB_API_ORIGIN)

  for (const name of [
    'default-src',
    'script-src',
    'style-src',
    'style-src-elem',
    'img-src',
    'font-src',
    'worker-src',
    'frame-src',
  ]) {
    expect(
      cspDirective(csp, name) ?? '',
      `${VERCEL_BLOB_API_ORIGIN} must stay out of ${name}`,
    ).not.toContain(VERCEL_BLOB_API_ORIGIN)
  }

  // The Toolbar's feedback iframe is the preview-only allowance this guards.
  expect(cspDirective(csp, 'frame-src')).toBe("frame-src 'self'")
})
