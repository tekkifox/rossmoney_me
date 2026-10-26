import type { Instrumentation } from 'next'

import { scrubErrorText } from './utilities/errorLog'
import {
  buildServerErrorReport,
  type ServerErrorContext,
  type ServerErrorRequest,
} from './utilities/serverErrorReport'

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
