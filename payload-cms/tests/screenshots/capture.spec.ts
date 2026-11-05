import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { test, type Page } from '@playwright/test'

import { login } from '../helpers/login'

/**
 * Captures full-page PNGs for the paths requested by the workflow. The output
 * is a manifest plus one `.png` and one `.txt` beside it: the text is the
 * page's visible text, which the publish step scans for values that must never
 * appear in the public repository.
 *
 * The default admin path needs a session. `rossmoney_dev` (and therefore the
 * throwaway copy this server uses) contains the development admin account, and
 * the login helper is the same one the browser smoke suite uses.
 */

const DEFAULT_PATHS = ['/', '/admin/collections/host-samples']
const ADMIN_EMAIL = process.env.SCREENSHOT_ADMIN_EMAIL || 'dev@payloadcms.com'
const ADMIN_PASSWORD = process.env.SCREENSHOT_ADMIN_PASSWORD || 'test'
const OUTPUT_DIR =
  process.env.SCREENSHOT_DIR || path.resolve(process.cwd(), 'test-results/screenshots')

type ManifestEntry = {
  name: string
  path: string
  url: string
}

const requestedPaths = (): string[] => {
  const raw = process.env.SCREENSHOT_PATHS?.trim()
  const paths = raw
    ? raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : DEFAULT_PATHS

  if (paths.length === 0) {
    throw new Error('SCREENSHOT_PATHS did not contain a path')
  }

  for (const target of paths) {
    if (!target.startsWith('/')) {
      throw new Error(`SCREENSHOT_PATHS entries must start with "/": ${target}`)
    }
  }

  return paths
}

const nameFor = (target: string): string => {
  if (target === '/') return 'home'
  const slug = target
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug || 'page'
}

const uniqueNames = (paths: string[]): Map<string, string> => {
  const names = new Map<string, string>()
  const seen = new Set<string>()

  for (const target of paths) {
    const base = nameFor(target)
    let name = base
    let suffix = 2
    while (seen.has(name)) {
      name = `${base}-${suffix}`
      suffix += 1
    }
    seen.add(name)
    names.set(target, name)
  }

  return names
}

const waitForRenderedPage = async (page: Page): Promise<void> => {
  // Not every page reaches `networkidle` (the admin can poll), so this is a
  // best-effort settle rather than a requirement. Fonts and images are awaited
  // explicitly so the screenshot does not catch a flash of fallback text.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.evaluate(async () => {
    const pending = Array.from(document.images)
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise<void>((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true })
            image.addEventListener('error', () => resolve(), { once: true })
          }),
      )
    await Promise.all(pending)
  })
}

const visibleText = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const lines: string[] = []
    const bodyText = document.body?.innerText
    if (bodyText) lines.push(bodyText)

    // Input values are not part of innerText, but they are visible on screen.
    for (const element of Array.from(document.querySelectorAll('input, textarea, select'))) {
      const value = (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
      if (value) lines.push(value)
    }

    return lines.join('\n')
  })
}

test('capture the requested pages', async ({ page, baseURL }) => {
  const paths = requestedPaths()
  const names = uniqueNames(paths)
  const entries: ManifestEntry[] = []
  const failures: string[] = []

  await mkdir(OUTPUT_DIR, { recursive: true })

  if (paths.some((target) => target.startsWith('/admin'))) {
    await login({
      page,
      serverURL: baseURL,
      user: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
  }

  for (const target of paths) {
    const name = names.get(target)
    if (!name) {
      failures.push(`${target}: no output name was allocated`)
      continue
    }

    try {
      const response = await page.goto(new URL(target, baseURL).toString(), {
        waitUntil: 'load',
      })
      if (!response || response.status() >= 400) {
        throw new Error(`page returned HTTP ${response?.status() ?? 'no response'}`)
      }

      await waitForRenderedPage(page)

      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${name}.png`),
        fullPage: true,
        animations: 'disabled',
      })
      await writeFile(path.join(OUTPUT_DIR, `${name}.txt`), await visibleText(page), 'utf8')

      entries.push({ name, path: target, url: page.url() })
      console.log(`Captured ${target} -> ${name}.png`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${target}: ${message}`)
      console.error(`::error::could not capture ${target}: ${message}`)
    }
  }

  await writeFile(
    path.join(OUTPUT_DIR, 'manifest.json'),
    `${JSON.stringify({ entries }, null, 2)}\n`,
    'utf8',
  )

  if (failures.length > 0) {
    throw new Error(`screenshot capture failed for:\n${failures.join('\n')}`)
  }
})
