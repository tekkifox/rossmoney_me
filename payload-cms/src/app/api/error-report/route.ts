import type { ErrorReportInput } from '@/utilities/errorLog'
import { ERROR_LOG_LIMITS, normaliseErrorReport, scrubErrorText } from '@/utilities/errorLog'
import { recordError } from '@/utilities/errorLogStore'
import { FixedWindowRateLimiter, clientAddress } from '@/utilities/rateLimit'
import { serverEnvironment, serverRelease } from '@/utilities/serverErrorReport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Bounds on the public reporting surface. These are separate instances of the
 * shared limiter class; the login/OG instances are untouched.
 *
 * 60 reports per address per minute is far above a real broken page (the client
 * reporter sends at most 20 and dedupes locally) and far below what is needed to
 * hurt the process. The process-wide ceiling stops a rotating-address flood on
 * a single self-hosted container.
 */
export const errorReportIpLimiter = new FixedWindowRateLimiter(60, 60 * 1_000)
export const errorReportGlobalLimiter = new FixedWindowRateLimiter(1_200, 60 * 1_000)

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  })

export type ErrorReportHandlerDeps = {
  record?: (input: ErrorReportInput) => Promise<unknown>
  ipLimiter?: FixedWindowRateLimiter
  globalLimiter?: FixedWindowRateLimiter
}

const ACCEPTED_CONTENT_TYPES = new Set(['', 'application/json', 'text/plain'])

/**
 * Handler factory so the route can be exercised in tests with a stub writer and
 * fresh limiters. Production uses the exported `POST` below.
 */
export function createErrorReportPost(deps: ErrorReportHandlerDeps = {}) {
  const record = deps.record ?? recordError
  const ipLimiter = deps.ipLimiter ?? errorReportIpLimiter
  const globalLimiter = deps.globalLimiter ?? errorReportGlobalLimiter

  return async function POST(request: Request): Promise<Response> {
    const address = clientAddress(request.headers)
    const perAddress = ipLimiter.take(address)
    const perProcess = globalLimiter.take('global')

    if (!perAddress.allowed || !perProcess.allowed) {
      const retryAfter = Math.max(perAddress.retryAfter, perProcess.retryAfter)
      return json(
        { errors: [{ message: 'Too many reports. Try again later.' }] },
        429,
        { 'Retry-After': String(Math.max(1, retryAfter)) },
      )
    }

    const declaredLength = Number(request.headers.get('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > ERROR_LOG_LIMITS.maxPayloadBytes) {
      return json({ errors: [{ message: 'Report too large.' }] }, 413)
    }

    const contentType = (request.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
      return json({ errors: [{ message: 'Expected a JSON body.' }] }, 415)
    }

    let text: string
    try {
      text = await request.text()
    } catch {
      return json({ errors: [{ message: 'Could not read the report.' }] }, 400)
    }

    if (new TextEncoder().encode(text).byteLength > ERROR_LOG_LIMITS.maxPayloadBytes) {
      return json({ errors: [{ message: 'Report too large.' }] }, 413)
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return json({ errors: [{ message: 'Invalid JSON.' }] }, 400)
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ errors: [{ message: 'Invalid report.' }] }, 400)
    }

    const raw = body as Record<string, unknown>
    const report = normaliseErrorReport({
      ...raw,
      message: raw.message,
      // A browser report cannot claim to be a server report; only the
      // instrumentation hook writes `source: 'server'`.
      source: raw.source === 'react' ? 'react' : 'client',
      // Server metadata is authoritative; a client cannot label its report with
      // a different environment or release.
      environment: serverEnvironment(),
      release: serverRelease(),
      userAgent: request.headers.get('user-agent') ?? raw.userAgent,
    })

    if (!report) {
      return json({ errors: [{ message: 'A message is required.' }] }, 400)
    }

    try {
      await record({
        level: report.level,
        source: report.source,
        message: report.message,
        stack: report.stack,
        route: report.route,
        url: report.url,
        environment: report.environment,
        release: report.release,
        userAgent: report.userAgent,
        timestamp: report.timestamp.toISOString(),
      })
    } catch (error) {
      // A broken writer is already handled inside `recordError`, but this route
      // must not fail the page even if that contract is ever broken.
      console.error(
        '[error-reporting] endpoint could not store report:',
        scrubErrorText(error instanceof Error ? error.message : String(error), 500),
      )
    }

    // Accepted whether or not the database took it: the reporter must never be
    // able to affect the visitor's page.
    return json({ ok: true }, 202)
  }
}

export const POST = createErrorReportPost()
