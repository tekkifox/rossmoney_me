import { expect, expectCspHeader, test, waitForPreviewFrame } from '../support/csp'
import {
  cleanupSmokePages,
  cleanupSmokeUser,
  readSmokePageTitle,
  seedSmokePage,
  seedSmokeUser,
  smokeUser,
} from '../support/db'

/**
 * Admin coverage: login, dashboard, the Pages list, a real edit + save through
 * the admin form, and Payload's Live Preview iframe.
 *
 * The page is seeded through the local API first. Driving the create view
 * directly is timing-dependent because Pages has autosave enabled: the
 * background save can replace the form before a browser-filled title reaches
 * the server, which made the first CI attempt flaky. Editing an existing page
 * still exercises an authenticated write and is deterministic.
 */
let smokePageId: string | number = ''

test.describe('Admin CSP smoke', () => {
  // Playwright requires this first argument to be destructured even though the
  // hook uses no fixtures.
  // oxlint-disable-next-line no-empty-pattern -- Playwright API, see above.
  test.beforeAll(async ({}, testInfo) => {
    await seedSmokeUser()
    smokePageId = await seedSmokePage(
      `csp-smoke-${testInfo.project.name}-${Date.now()}`,
    )
  })

  test.afterAll(async () => {
    await cleanupSmokePages()
    await cleanupSmokeUser()
  })

  test('login, list, edit + save, and render Live Preview without CSP violations', async ({
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

    const editResponse = await page.goto(`/admin/collections/pages/${smokePageId}`)
    expectCspHeader(editResponse, { admin: true })

    const titleInput = page.locator('input[name="title"]')
    await expect(titleInput).toHaveValue('CSP smoke seed')

    const title = `CSP smoke ${testInfo.project.name} ${Date.now()}`
    await titleInput.fill(title)

    // Autosave may already have persisted the change, in which case the publish
    // button is disabled. Click it when it is available, then verify the value
    // landed in the database rather than trusting transient form state.
    const saveButton = page.locator('#action-save')
    if (await saveButton.isEnabled()) {
      await saveButton.click()
    }

    await expect
      .poll(() => readSmokePageTitle(smokePageId), {
        timeout: 60_000,
        message: 'the edited title was not persisted',
      })
      .toBe(title)

    // Reload the saved document as a full navigation. This also proves the
    // admin CSP header is present on the edit view after the write.
    const reloadResponse = await page.goto(page.url())
    expectCspHeader(reloadResponse, { admin: true })
    await expect(page.locator('input[name="title"]')).toHaveValue(title)

    const previewToggler = page.locator('#live-preview-toggler')
    await expect(previewToggler).toBeVisible({ timeout: 60_000 })
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
