import configPromise from '@payload-config'
import { head, put } from '@vercel/blob'
import { getPayload } from 'payload'

import {
  DEFAULT_MEDIA_SOURCE,
  MEDIA_SOURCE_HOSTS,
  resolveMediaSource,
  runMediaBackfill,
  type MediaBackfillDocument,
  type MediaBackfillStore,
} from '@/utilities/mediaBackfill'

/**
 * Copy the media files a refreshed database references into the Vercel Blob
 * store. The blob adapter builds every URL from the filename, so uploading the
 * rows' bytes is the only way to make the dev site's media load again.
 *
 * Authentication mirrors `(payload)/api/users/init/route.ts`: Payload refreshes
 * the session through `responseHeaders`, anonymous callers get a 404 instead of
 * learning that the route exists, and a signed-in user from another auth
 * collection is refused with 403.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type AuthenticatedUser = {
  collection?: string
}

export type MediaBackfillPayload = {
  auth: (args: {
    canSetHeaders: boolean
    headers: Headers
  }) => Promise<{
    responseHeaders?: Headers
    user?: AuthenticatedUser | null
  }>
  find: (args: {
    collection: 'media'
    depth: 0
    pagination: false
  }) => Promise<{ docs: MediaBackfillDocument[] }>
}

export type MediaBackfillRouteDeps = {
  loadPayload?: () => Promise<MediaBackfillPayload>
  store?: MediaBackfillStore
  fetchImpl?: typeof fetch
  /** `null` means "no token", even if the environment has one (tests). */
  token?: string | null
  allowedHosts?: readonly string[]
  defaultSource?: string
  perFileTimeoutMs?: number
  concurrency?: number
}

const defaultLoadPayload = async (): Promise<MediaBackfillPayload> =>
  (await getPayload({ config: configPromise })) as unknown as MediaBackfillPayload

const defaultStore: MediaBackfillStore = {
  head: (pathname, options) => head(pathname, options),
  put: (pathname, body, options) => put(pathname, body, options),
}

const json = (body: unknown, status: number, headers: Headers): Response =>
  Response.json(body, { status, headers })

type BodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

async function readBody(request: Request): Promise<BodyResult> {
  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, error: 'The request body could not be read.' }
  }

  if (!text.trim()) {
    return { ok: true, value: {} }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The request body must be JSON.' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'The request body must be a JSON object.' }
  }

  return { ok: true, value: parsed as Record<string, unknown> }
}

function configuredToken(deps: MediaBackfillRouteDeps): string | undefined {
  if (deps.token === null) {
    return undefined
  }

  return deps.token?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim() || undefined
}

export function createMediaBackfillPost(deps: MediaBackfillRouteDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    const headers = new Headers({ 'Cache-Control': 'private, no-store' })

    const payload = await (deps.loadPayload ?? defaultLoadPayload)()

    let auth: Awaited<ReturnType<MediaBackfillPayload['auth']>>
    try {
      auth = await payload.auth({ canSetHeaders: true, headers: request.headers })
    } catch {
      return json({ errors: [{ message: 'Not found' }] }, 404, headers)
    }

    auth.responseHeaders?.forEach((value, key) => headers.append(key, value))

    if (!auth.user) {
      return json({ errors: [{ message: 'Not found' }] }, 404, headers)
    }

    // The users collection is the admin collection in this app. Any other auth
    // collection would be a non-admin caller.
    if (auth.user.collection !== 'users') {
      return json({ errors: [{ message: 'Forbidden' }] }, 403, headers)
    }

    const token = configuredToken(deps)
    if (!token) {
      return json(
        {
          ok: false,
          error:
            'BLOB_READ_WRITE_TOKEN is not configured. Media backfill requires Vercel Blob storage.',
        },
        503,
        headers,
      )
    }

    const parsedBody = await readBody(request)
    if (!parsedBody.ok) {
      return json({ ok: false, error: parsedBody.error }, 400, headers)
    }

    const body = parsedBody.value
    if (body.source !== undefined && typeof body.source !== 'string') {
      return json({ ok: false, error: '`source` must be a string.' }, 400, headers)
    }
    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
      return json({ ok: false, error: '`dryRun` must be a boolean.' }, 400, headers)
    }

    const requestedSource = typeof body.source === 'string' ? body.source.trim() : ''
    const source =
      requestedSource ||
      process.env.MEDIA_SOURCE?.trim() ||
      deps.defaultSource ||
      DEFAULT_MEDIA_SOURCE

    const resolved = resolveMediaSource(source, deps.allowedHosts ?? MEDIA_SOURCE_HOSTS)
    if (!resolved.ok) {
      return json({ ok: false, error: resolved.error }, 400, headers)
    }

    let docs: MediaBackfillDocument[]
    try {
      const found = await payload.find({ collection: 'media', depth: 0, pagination: false })
      docs = found.docs
    } catch {
      return json({ ok: false, error: 'Could not read media documents.' }, 500, headers)
    }

    const result = await runMediaBackfill({
      docs,
      source: resolved.source,
      token,
      store: deps.store ?? defaultStore,
      fetchImpl: deps.fetchImpl ?? fetch,
      dryRun: body.dryRun === true,
      perFileTimeoutMs: deps.perFileTimeoutMs,
      concurrency: deps.concurrency,
    })

    return json(result, 200, headers)
  }
}

export const POST = createMediaBackfillPost()
