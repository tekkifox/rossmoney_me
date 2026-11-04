import {
  ACKEE_DOMAIN_ID,
  ACKEE_OPTS,
} from '../../../src/utilities/ackeeTracker'
import { expect, expectCspHeader, test } from '../support/csp'

/**
 * Public production pages. One test per route so a failure names the page, and
 * both the Chromium and Firefox projects run the same list.
 *
 * `#page-root` is rendered by the shared `[slug]` page component, which every
 * seeded page (including `/`) uses. Asserting it means a 404 or a seeding
 * failure cannot masquerade as a clean CSP run.
 */
const PUBLIC_PAGES = ['/', '/cv', '/contact', '/travelling', '/game-servers']

for (const path of PUBLIC_PAGES) {
  test(`public page ${path} loads with no CSP violations`, async ({ page }) => {
    const response = await page.goto(path, { waitUntil: 'load' })
    expectCspHeader(response)
    expect(response?.status(), `${path} should be served successfully`).toBe(200)

    await expect(page.locator('#page-root')).toBeVisible()

    // Give late resource loads (fonts, images, client fetches) a chance to
    // fire. The fixture asserts at teardown, so this is not the only guard.
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(250)
  })
}

test('public page loads the first-party Ackee tracker with no CSP violation', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'load' })
  const csp = expectCspHeader(response)

  const tracker = page.locator(`script[data-ackee-domain-id="${ACKEE_DOMAIN_ID}"]`)
  await expect(tracker, 'production must render exactly one tracker').toHaveCount(1)

  const src = await tracker.getAttribute('src')
  expect(src, 'tracker must stay first-party under /a').toMatch(
    /^https?:\/\/[^/]+\/a\/tracker\.js$/,
  )
  await expect(tracker).toHaveAttribute('data-ackee-server', /\/a$/)
  await expect(tracker).toHaveAttribute('data-ackee-opts', ACKEE_OPTS)

  const nonce = await tracker.evaluate((element) => (element as HTMLScriptElement).nonce)
  expect(nonce, 'tracker script must carry the request nonce').toBeTruthy()
  expect(csp, 'the tracker nonce must match the request policy').toContain(`'nonce-${nonce}'`)

  // The fixture's teardown fails the test on any securitypolicyviolation, so
  // this also covers the tracker load being blocked by script-src.
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(250)
})
