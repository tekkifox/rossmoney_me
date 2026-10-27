import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import 'dotenv/config'

const isCI = Boolean(process.env.CI)
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const port = new URL(baseURL).port || '3000'

/**
 * The CSP smoke suite only means something against a production build: the
 * proxy intentionally omits the policy in `next dev`. Locally that means
 * `pnpm dev:prod` (build + start); CI builds first and only starts the server.
 * Set `PLAYWRIGHT_WEB_SERVER_COMMAND` to point at a server you already run.
 */
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? (isCI ? 'pnpm start' : 'pnpm dev:prod')

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Payload's admin route compiles lazily under `next dev`; on a cold server the
  // first login can take longer than Playwright's 30s default. The wait is
  // compilation, not a stalled test, so allow it.
  timeout: 120_000,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: isCI,
  /* Retry on CI only */
  retries: isCI ? 2 : 0,
  /*
   * The admin specs share a database and seed/delete users. One worker keeps
   * those writes deterministic and still finishes the smoke set quickly.
   */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'html',
  expect: {
    timeout: 10_000,
  },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Keep evidence for any failure, not just retried ones. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 300_000,
    // `next start` reads PORT; set it explicitly so a non-default
    // PLAYWRIGHT_BASE_URL is served on the matching port (and so this works
    // on Windows, where `PORT=... command` is not valid shell syntax).
    env: { ...(process.env as Record<string, string>), PORT: port },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
