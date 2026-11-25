import { defineConfig, devices } from '@playwright/test'

/**
 * Screenshot capture runs separately from `pnpm test:e2e` so the browser smoke
 * suite keeps its own database, assertions and reporter. It runs from a copy of
 * the production build (`SCREENSHOT_DIST_DIR`) and drives the same login helper.
 *
 * The server starts against the throwaway copy prepared by the workflow
 * (`SCREENSHOT_MONGODB_URI`), never against `rossmoney_dev` itself. It listens
 * on a port other than the e2e server's because the two servers must be able to
 * coexist in one job, and `HOST_SAMPLER=off` keeps CI from writing samples.
 * The separate build directory matters as much as the separate database: the
 * full route cache lives inside `distDir`, so a shared build would let this
 * server answer with a page the smoke server rendered against its own data.
 */
import 'dotenv/config'

const baseURL = process.env.SCREENSHOT_BASE_URL || 'http://localhost:3001'
const port = new URL(baseURL).port || '3001'

const webServerEnv = {
  ...(process.env as Record<string, string>),
  PORT: port,
  MONGODB_URI: process.env.SCREENSHOT_MONGODB_URI || process.env.MONGODB_URI || '',
  // Payload builds its CSRF allowlist and absolute URLs from this origin. The
  // browser talks to localhost:3001, so the server must agree.
  SERVER_URL: baseURL,
  NEXT_PUBLIC_SERVER_URL: baseURL,
  HOST_SAMPLER: 'off',
  // CI always runs this server against a throwaway copy, and force-seeding is
  // what makes a pull request that changes a seeded page show that change.
  // Force-seeding merges page fields; it never replaces the CV media an editor
  // uploaded, so the copied `rossmoney_dev` keeps its real CV.
  PAYLOAD_SEED: process.env.PAYLOAD_SEED ?? 'true',
  // The workflow copies the production build into a second directory so this
  // server cannot read the route cache the smoke server wrote against its own
  // database. `next.config.ts` uses this as `distDir`. Unset for a local run,
  // which keeps the normal `.next` build.
  NEXT_DIST_DIR: process.env.SCREENSHOT_DIST_DIR || '.next',
  NEXT_TELEMETRY_DISABLED: '1',
}

export default defineConfig({
  testDir: './tests/screenshots',
  timeout: 300_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // One worker keeps the shared admin session and the output directory
  // deterministic.
  workers: 1,
  reporter: 'list',
  outputDir: './test-results/screenshot-artifacts',
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    navigationTimeout: 120_000,
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        // `devices['Desktop Chrome']` sets its own 1280×720 viewport, which
        // would override the top-level `use.viewport`. The screenshots must be
        // 1440px wide, so restate the size on the project.
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    // Bind loopback so `next start` does not print the runner's network
    // address into the public CI log. `start:loopback` also resets
    // NODE_OPTIONS, which the Next config loader needs when Playwright itself
    // was started with tsx.
    command: process.env.SCREENSHOT_WEB_SERVER_COMMAND ?? 'pnpm start:loopback',
    // Readiness waits for the admin login page, not `/`. The public homepage is
    // prerendered and answers before `onInit` finishes seeding, while the admin
    // route is dynamic and only answers once the seed is done. Seeding a copy
    // of the dev database can wait on a media fetch that times out after five
    // minutes, so the web-server timeout has to cover that wait.
    url: `${baseURL}/admin/login`,
    reuseExistingServer: false,
    timeout: 600_000,
    env: webServerEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
