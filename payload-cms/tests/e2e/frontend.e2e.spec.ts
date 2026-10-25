import { test, expect, Page } from '@playwright/test'

test.describe('Frontend', () => {
  // Kept for parity with the original setup: the smoke test itself uses
  // Playwright's per-test `page` fixture, so this context is never asserted on.
  let _page: Page

  test.beforeAll(async ({ browser }, _testInfo) => {
    const context = await browser.newContext()
    _page = await context.newPage()
  })

  test('can load homepage', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await expect(page).toHaveTitle(/Ross Money - Developer & DevOps Portfolio/)
    const heading = page.locator('h1').first()
    await expect(heading).toHaveText('Building dependable systems with operational discipline.')
  })
})
