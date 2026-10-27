import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
  type Response as PlaywrightResponse,
} from '@playwright/test'

/**
 * Browser CSP smoke guard.
 *
 * Every test that imports `test` from this module gets a `securitypolicyviolation`
 * listener installed at document start in *every* frame of the context, including
 * the same-origin Live Preview iframe. Violations are collected in Node and the
 * fixture fails the test during teardown, so a page cannot pass just because the
 * assertion in the test body happened before a late violation fired.
 *
 * The listener is installed with `context.addInitScript`, which Playwright runs
 * in every current and future frame. The binding lets a violation reach Node
 * even if the document that fired it is navigated away from (for example the
 * `/next/preview` document that redirects to the public page in Live Preview).
 */

export type CspViolation = {
  effectiveDirective: string
  violatedDirective: string
  blockedURI: string
  sourceFile: string
  lineNumber: number
  columnNumber: number
  sample: string
  documentURI: string
  disposition: string
  frameUrl?: string
}

const VIOLATION_BINDING = '__cspViolationReport'
const VIOLATION_QUEUE = '__cspViolationQueue'

/**
 * Runs in the browser before any page script. Kept as a standalone function so
 * Playwright can serialise it into every frame without closing over Node state.
 */
const installViolationListener = () => {
  type CspWindow = Window & {
    __cspViolationQueue?: CspViolation[]
    __cspViolationReport?: (violation: CspViolation) => void
  }

  const cspWindow = window as CspWindow
  const queue = (cspWindow.__cspViolationQueue ||= [])

  document.addEventListener(
    'securitypolicyviolation',
    (event) => {
      const violation = event as SecurityPolicyViolationEvent
      const entry: CspViolation = {
        effectiveDirective: violation.effectiveDirective || violation.violatedDirective,
        violatedDirective: violation.violatedDirective,
        blockedURI: violation.blockedURI,
        sourceFile: violation.sourceFile,
        lineNumber: violation.lineNumber,
        columnNumber: violation.columnNumber,
        sample: violation.sample,
        documentURI: violation.documentURI,
        disposition: violation.disposition,
      }

      // Keep a copy in the document itself as a fallback for the (unlikely)
      // case where the exposed binding is not available in this frame.
      queue.push(entry)

      if (typeof cspWindow.__cspViolationReport === 'function') {
        cspWindow.__cspViolationReport(entry)
      }
    },
    { capture: true },
  )
}

const violationKey = (violation: CspViolation): string =>
  [
    violation.effectiveDirective,
    violation.blockedURI,
    violation.sourceFile,
    violation.lineNumber,
    violation.columnNumber,
    violation.documentURI,
    violation.sample,
  ].join('|')

const formatViolations = (violations: CspViolation[]): string =>
  [
    `Content-Security-Policy violations detected (${violations.length}):`,
    ...violations.map((violation, index) => {
      const location = violation.sourceFile
        ? `${violation.sourceFile}${
            violation.lineNumber ? `:${violation.lineNumber}` : ''
          }${violation.columnNumber ? `:${violation.columnNumber}` : ''}`
        : '(inline document)'

      return [
        `${index + 1}. directive: ${violation.effectiveDirective}`,
        `   blocked URI: ${violation.blockedURI || '(empty)'}`,
        `   source: ${location}`,
        `   document: ${violation.documentURI}`,
        violation.frameUrl ? `   frame: ${violation.frameUrl}` : null,
        violation.sample ? `   sample: ${violation.sample}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    }),
  ].join('\n\n')

const settlePendingViolations = async (context: BrowserContext) => {
  for (const page of context.pages()) {
    // Give binding calls and late events (fonts, images, async fetches) a
    // chance to reach the listener and Node before we assert.
    await page
      .evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => setTimeout(resolve, 0))
          }),
      )
      .catch(() => undefined)
  }
}

const collectQueuedViolations = async (
  context: BrowserContext,
): Promise<CspViolation[]> => {
  const queued: CspViolation[] = []

  for (const page of context.pages()) {
    for (const frame of page.frames()) {
      try {
        const frameViolations = (await frame.evaluate(
          (queueName) =>
            ((window as unknown as Record<string, unknown>)[queueName] as
              | CspViolation[]
              | undefined) ?? [],
          VIOLATION_QUEUE,
        )) as CspViolation[]

        for (const violation of frameViolations) {
          queued.push({ ...violation, frameUrl: frame.url() })
        }
      } catch {
        // Cross-origin frames cannot be inspected. Their violations, if any,
        // are still delivered through the context binding.
      }
    }
  }

  return queued
}

type CspFixtures = {
  /**
   * Auto fixture: importing `test` from this module is enough. The name is
   * exposed so a test can opt into a custom teardown message if it needs to.
   */
  cspGuard: void
}

export const test = base.extend<CspFixtures>({
  cspGuard: [
    async ({ context }, use) => {
      const violations: CspViolation[] = []

      await context.exposeBinding(
        VIOLATION_BINDING,
        (source, violation: CspViolation) => {
          violations.push({ ...violation, frameUrl: source.frame.url() })
        },
      )
      await context.addInitScript(installViolationListener)

      await use()

      await settlePendingViolations(context)
      violations.push(...(await collectQueuedViolations(context)))

      const uniqueViolations = [
        ...new Map(
          violations.map((violation) => [violationKey(violation), violation]),
        ).values(),
      ]

      expect(
        uniqueViolations,
        formatViolations(uniqueViolations),
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** Parse one directive out of a CSP header value (case-sensitive names). */
export const cspDirective = (
  header: string,
  name: string,
): string | undefined =>
  header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `))

/**
 * Assert the document response carries the production policy. On a dev server
 * the proxy intentionally sends no CSP, so this also stops the smoke suite from
 * passing silently against `pnpm dev`.
 */
export const expectCspHeader = (
  response: PlaywrightResponse | null,
  options: { admin?: boolean } = {},
): string => {
  const { admin = false } = options

  if (!response) {
    throw new Error('Expected a document response, but navigation returned null.')
  }

  const header = response.headers()['content-security-policy']

  if (!header) {
    throw new Error(
      `Expected a Content-Security-Policy header on ${response.url()}. ` +
        'The smoke suite must run against a production build (`pnpm build && pnpm start`), ' +
        'not `pnpm dev`, which intentionally omits the policy.',
    )
  }

  expect(header, 'CSP must start from a deny-all default').toContain(
    "default-src 'none'",
  )
  expect(header, 'CSP scripts must be nonce-based').toMatch(
    /script-src 'nonce-[A-Za-z0-9+/_-]+={0,2}' 'strict-dynamic'/,
  )

  if (admin) {
    expect(cspDirective(header, 'frame-src')).toContain("'self'")
    expect(cspDirective(header, 'frame-ancestors')).toBe("frame-ancestors 'none'")
  } else {
    expect(cspDirective(header, 'frame-ancestors')).toBe(
      "frame-ancestors 'self'",
    )
    expect(cspDirective(header, 'style-src-elem')).not.toContain(
      "'unsafe-inline'",
    )
  }

  return header
}

/** Waits for the Live Preview iframe to finish redirecting to the public page. */
export const waitForPreviewFrame = async (
  page: Page,
  slugFragment: string,
): Promise<import('@playwright/test').Frame> => {
  const findFrame = () =>
    page.frames().find(
      (frame) =>
        frame !== page.mainFrame() &&
        frame.parentFrame() === page.mainFrame() &&
        frame.url().includes(slugFragment),
    )

  await expect
    .poll(() => findFrame()?.url() ?? '', {
      timeout: 30_000,
      message: `Live Preview iframe never navigated to a URL containing "${slugFragment}"`,
    })
    .toContain(slugFragment)

  const frame = findFrame()

  if (!frame) {
    throw new Error(
      `Live Preview iframe for "${slugFragment}" was not found. Frames: ${page
        .frames()
        .map((candidate) => candidate.url())
        .join(', ')}`,
    )
  }

  return frame
}
