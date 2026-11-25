import type { Instrumentation } from 'next'

import { scrubErrorText } from './utilities/errorLog'
import {
  buildServerErrorReport,
  type ServerErrorContext,
  type ServerErrorRequest,
} from './utilities/serverErrorReport'

/**
 * Starts process-lifetime work before the server handles requests.
 *
 * Next.js calls `register` once per server process, outside any request or
 * render context (and skips it during the production build). The host sampler
 * used to be created inside Payload's `onInit`, which first runs wherever
 * Payload is first used — on a production build that can be the static render
 * of `/[slug]`. A timer created in that async context kept it forever, so every
 * later tick's `no-store` fetch was judged to be part of the static render and
 * rejected with `DynamicServerError`. Starting the timer here keeps every tick
 * outside that context.
 */
export async function register(): Promise<void> {
  // `register` also runs for edge routes, where Payload and its MongoDB adapter
  // cannot run. The sampler only belongs in the Node server.
  if (process.env.NEXT_RUNTIME === 'edge') return

  const { startHostSampler } = await import('./utilities/hostSamplerSchedule')
  startHostSampler()
}

/**
 * Next.js calls this for uncaught errors while rendering a route, running a
 * route handler, a server action or the proxy. Registered by file convention
 * (`src/instrumentation.ts`), verified against the installed Next 16.4.3 which
 * exposes `onRequestError` in its instrumentation types.
 *
 * The database module is imported lazily so a build, an edge bundle or a
 * request that never errors does not pay for Payload initialisation.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  try {
    // The reporting endpoint must never report its own failure: that would be a
    // write loop when the database is the thing that is down.
    if (request.path === '/api/error-report') {
      return
    }

    // `onRequestError` is also compiled for the edge runtime, where the Payload
    // MongoDB adapter cannot run. Node server routes are covered; edge failures
    // are not captured by this in-house sink.
    if (process.env.NEXT_RUNTIME === 'edge') {
      return
    }

    const { recordError } = await import('./utilities/errorLogStore')
    await recordError(
      buildServerErrorReport(
        error,
        request as unknown as ServerErrorRequest,
        context as ServerErrorContext,
      ),
    )
  } catch (reportingError) {
    // Last line of defence: reporting must never become a second error.
    console.error(
      '[error-reporting] instrumentation failed:',
      scrubErrorText(
        reportingError instanceof Error ? reportingError.message : String(reportingError),
        500,
      ),
    )
  }
}
