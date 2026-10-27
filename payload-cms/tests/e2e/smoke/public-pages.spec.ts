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
