import { expect, expectCspHeader, test, waitForPreviewFrame } from '../support/csp'
import {
  cleanupSmokePages,
  cleanupSmokeUser,
  seedSmokeUser,
  smokeUser,
} from '../support/db'

/**
 * Admin coverage: login, dashboard, the Pages list, a real create + publish,
 * and Payload's Live Preview iframe.
 *
 * Live Preview is disabled on the create view until the document exists, so the
 * test creates a page first. That also exercises a real write through Payload's
 * authenticated server functions, not just read-only admin views.
 */
test.describe('Admin CSP smoke', () => {
  test.beforeAll(async () => {
    await seedSmokeUser()
  })

  test.afterAll(async () => {
    await cleanupSmokePages()
    await cleanupSmokeUser()
  })

  test('login, list, create + publish, and render Live Preview without CSP violations', async ({
    page,
  }, testInfo) => {
    const loginResponse = await page.goto('/admin/login')
    expectCspHeader(loginResponse, { admin: true })

    await page.fill('#field-email', smokeUser.email)
    await page.fill('#field-password', smokeUser.password)
    await page.click('button[type="submit"]')

    await page.waitForURL('**/admin')
    await expect(page.locator('span[title="Dashboard"]').first()).toBeVisible()

    const dashboardResponse = await page.goto('/admin')
    expectCspHeader(dashboardResponse, { admin: true })
    await expect(page.locator('span[title="Dashboard"]').first()).toBeVisible()

    const listResponse = await page.goto('/admin/collections/pages')
    expectCspHeader(listResponse, { admin: true })
    await expect(page.locator('h1', { hasText: 'Pages' }).first()).toBeVisible()

    const createResponse = await page.goto('/admin/collections/pages/create')
    expectCspHeader(createResponse, { admin: true })

    const titleInput = page.locator('input[name="title"]')
    await expect(titleInput).toBeVisible()
    await titleInput.fill(`CSP smoke ${testInfo.project.name} ${Date.now()}`)

    await page.locator('#action-save').click()

    // A successful save leaves the create view and opens the new document.
    await page.waitForURL(
      (url) => /\/admin\/collections\/pages\/(?!create$)[^/]+$/.test(url.pathname),
      { timeout: 60_000 },
    )

    const previewToggler = page.locator('#live-preview-toggler')
    await expect(previewToggler).toBeVisible({ timeout: 30_000 })
    await previewToggler.click()

    const previewFrameElement = page.locator('#live-preview-iframe')
    await expect(previewFrameElement).toBeVisible()

    // The preview URL starts as `/next/preview?...` and redirects to the public
    // page with draft mode enabled. If `frame-src` or `frame-ancestors` blocks
    // the frame, this never resolves and the test fails here even before the
    // teardown violation check.
    const previewFrame = await waitForPreviewFrame(page, 'csp-smoke')

    await expect(previewFrame.locator('#page-root')).toBeVisible({
      timeout: 30_000,
    })

    await page.waitForTimeout(250)
  })
})
