import {
  normaliseErrorReport,
  type ErrorReportInput,
  type NormalisedErrorReport,
} from './errorLog'

/**
 * Browser-side error reporting.
 *
 * Rules: never throw, never block the page, never flood the endpoint. The
 * report is scrubbed and fingerprinted locally first, then sent to the
 * same-origin endpoint with `keepalive` so a crash during unload still lands.
 */

const ENDPOINT = '/api/error-report'
/** Hard stop for a page that is stuck in an error loop. */
const MAX_REPORTS_PER_PAGE = 20
/** One report per fingerprint per half minute is plenty for the admin view. */
const SAME_ERROR_WINDOW_MS = 30_000

const IGNORED_MESSAGES = /ResizeObserver loop|^Script error\.?$/i

const lastReportAt = new Map<string, number>()
let reportsSent = 0

const payloadFor = (report: NormalisedErrorReport) => ({
  level: report.level,
  source: report.source,
  message: report.message,
  stack: report.stack,
  route: report.route,
  url: report.url,
  userAgent: report.userAgent,
  timestamp: report.timestamp.toISOString(),
})

const send = (body: string): void => {
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      // Keeps the request alive when the page is being torn down.
      keepalive: true,
      credentials: 'omit',
      cache: 'no-store',
    }).catch(() => {
      // The reporter is best-effort; a failed report is not a page failure.
    })
  } catch {
    // `fetch` can throw synchronously (e.g. an invalid URL shim). Fall back to
    // beacon, then give up without surfacing anything to the visitor.
    try {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon?.(ENDPOINT, blob)
    } catch {
      // Ignore.
    }
  }
}

/**
 * Scrub, dedupe locally and post. Safe to call from an event handler or a React
 * error boundary; it never throws.
 */
export function reportClientError(input: ErrorReportInput): void {
  try {
    const report = normaliseErrorReport(input)
    if (!report || IGNORED_MESSAGES.test(report.message)) {
      return
    }

    const now = Date.now()
    const previous = lastReportAt.get(report.fingerprint)
    if (previous !== undefined && now - previous < SAME_ERROR_WINDOW_MS) {
      return
    }

    if (reportsSent >= MAX_REPORTS_PER_PAGE) {
      return
    }

    reportsSent += 1
    lastReportAt.set(report.fingerprint, now)

    // Keep the map bounded if a page somehow sees many distinct errors.
    if (lastReportAt.size > 100) {
      lastReportAt.clear()
      lastReportAt.set(report.fingerprint, now)
    }

    send(JSON.stringify(payloadFor(report)))
  } catch {
    // Never let the reporter throw into application code.
  }
}

const currentPage = () => {
  if (typeof window === 'undefined') {
    return { route: '/', url: '/' }
  }
  return { route: window.location.pathname, url: window.location.href }
}

/** Report an error caught by a React error boundary. */
export function reportReactError(error: Error & { digest?: string }): void {
  const page = currentPage()
  const stack = error.digest
    ? `${error.stack || ''}\nDigest: ${error.digest}`
    : error.stack

  reportClientError({
    level: 'error',
    source: 'react',
    message: error.message || 'React render error',
    stack,
    route: page.route,
    url: page.url,
  })
}

/**
 * Attach `window.onerror` and `unhandledrejection` listeners. Returns a cleanup
 * function so React strict mode / fast refresh does not stack handlers.
 */
export function installErrorReporting(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const onError = (event: ErrorEvent): void => {
    const message = event.message || event.error?.message
    if (!message) {
      return
    }

    const page = currentPage()
    reportClientError({
      level: 'error',
      source: 'client',
      message,
      stack: event.error?.stack,
      route: page.route,
      url: page.url,
    })
  }

  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection'
    const page = currentPage()

    reportClientError({
      level: 'error',
      source: 'client',
      message: message || 'Unhandled promise rejection',
      stack: reason instanceof Error ? reason.stack : undefined,
      route: page.route,
      url: page.url,
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}
