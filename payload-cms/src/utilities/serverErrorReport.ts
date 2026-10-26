import type { ErrorReportInput } from './errorLog'

/**
 * The shape Next.js hands to `instrumentation.ts#onRequestError`. Declared
 * locally so this module (and its tests) do not depend on Next internals.
 */
export type ServerErrorRequest = {
  path: string
  method: string
  headers: Record<string, string | string[] | undefined>
}

export type ServerErrorContext = {
  routePath?: string
  routeType?: string
  routerKind?: string
}

const headerValue = (
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string => {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

/** Deployment identity, only when it is free to read from the environment. */
export const serverEnvironment = (
  env: Record<string, string | undefined> = process.env,
): string => env.VERCEL_ENV || env.NODE_ENV || 'unknown'

export const serverRelease = (
  env: Record<string, string | undefined> = process.env,
): string => {
  const release =
    env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || env.SOURCE_VERSION || env.RELEASE || ''
  return release ? release.slice(0, 12) : 'unknown'
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return 'Unknown server error'
}

const errorStack = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return ''
  }

  const digest = (error as Error & { digest?: unknown }).digest
  const stack = error.stack || ''
  return typeof digest === 'string' && digest ? `${stack}\nDigest: ${digest}` : stack
}

/**
 * Turn a server-side request failure into the same shape the browser reporter
 * sends, so there is one storage path and one set of scrubbing rules.
 */
export function buildServerErrorReport(
  error: unknown,
  request: ServerErrorRequest,
  context: ServerErrorContext = {},
): ErrorReportInput {
  const route = context.routePath || request.path || '/'

  return {
    level: 'error',
    source: 'server',
    message: errorMessage(error),
    stack: errorStack(error),
    route,
    url: request.path || route,
    environment: serverEnvironment(),
    release: serverRelease(),
    userAgent: headerValue(request.headers, 'user-agent'),
    timestamp: new Date(),
  }
}
