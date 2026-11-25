/**
 * Helpers for copying the media files that a refreshed dev database references
 * into the Vercel Blob store. The database rows keep their filenames; the blob
 * adapter regenerates every URL from the filename, so the bytes must exist at
 * the same pathname in the store.
 */

/**
 * The public site serves its uploads under `/media`, which is also where the
 * self-hosted deployment mirrors production files. A deployment can point the
 * backfill at another mirror with `MEDIA_SOURCE`; the request body can override
 * both for a one-off run.
 */
export const DEFAULT_MEDIA_SOURCE = 'https://www.rossmoney.me/media'

/**
 * The only hosts the backfill may read from. Keeping this to the public site
 * stops an authenticated admin (or a mistyped environment variable) from
 * turning the route into a server-side request forger.
 */
export const MEDIA_SOURCE_HOSTS = ['www.rossmoney.me', 'rossmoney.me'] as const

export type MediaBackfillDocument = {
  filename?: string | null
  sizes?: Record<string, { filename?: string | null } | null | undefined> | null
}

export type MediaBackfillTarget = {
  pathname: string
  /** Image size variants are optional: a source may only serve the original. */
  optional: boolean
}

export type MediaBackfillStore = {
  head: (
    pathname: string,
    options: { token: string; abortSignal: AbortSignal },
  ) => Promise<unknown>
  put: (
    pathname: string,
    body: ArrayBuffer,
    options: {
      token: string
      access: 'public'
      addRandomSuffix: false
      allowOverwrite: true
      contentType?: string
      abortSignal: AbortSignal
    },
  ) => Promise<unknown>
}

export type MediaBackfillResult = {
  ok: boolean
  uploaded: string[]
  skipped: string[]
  failed: Array<{ filename: string; error: string }>
}

export type ResolvedMediaSource =
  | { ok: true; source: string }
  | { ok: false; error: string }

const trimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/**
 * Validate and normalise a source prefix. Only HTTPS URLs on the allow-list are
 * accepted; the path may point at a mirror (`/media`) but must not carry a query
 * or fragment because filenames are appended to it.
 */
export function resolveMediaSource(
  raw: unknown,
  allowedHosts: readonly string[] = MEDIA_SOURCE_HOSTS,
): ResolvedMediaSource {
  const candidate = trimmedString(raw)
  if (!candidate) {
    return { ok: false, error: 'A media source is required.' }
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, error: 'The media source must be an absolute URL.' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'The media source must use https.' }
  }

  if (url.username || url.password) {
    return { ok: false, error: 'The media source must not contain credentials.' }
  }

  if (url.search || url.hash) {
    return {
      ok: false,
      error: 'The media source must not contain a query string or fragment.',
    }
  }

  const host = url.hostname.toLowerCase()
  const allowed = allowedHosts.some((entry) => entry.toLowerCase() === host)
  if (!allowed) {
    return {
      ok: false,
      error: `The media source host ${host} is not on the allow-list.`,
    }
  }

  return { ok: true, source: url.toString().replace(/\/+$/, '') }
}

/**
 * Pathnames the adapter will look up for one media document: the original
 * filename followed by each generated image size. The collection sets no
 * storage prefix and the adapter derives the pathname from the filename alone.
 */
export function mediaBackfillTargets(doc: MediaBackfillDocument): MediaBackfillTarget[] {
  const targets: MediaBackfillTarget[] = []
  const seen = new Set<string>()

  const add = (value: unknown, optional: boolean) => {
    const pathname = trimmedString(value)
    if (!pathname || seen.has(pathname)) {
      return
    }
    seen.add(pathname)
    targets.push({ pathname, optional })
  }

  add(doc.filename, false)
  for (const size of Object.values(doc.sizes ?? {})) {
    add(size?.filename, true)
  }

  return targets
}

/**
 * Reject names that could escape the store's root when the blob client joins
 * the pathname. Payload sanitises uploads, so this only guards against a
 * hand-edited database.
 */
function isSafePathname(pathname: string): boolean {
  if (!pathname || pathname.startsWith('/') || pathname.includes('\\')) {
    return false
  }

  return pathname.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  // Keep the response readable; the full object is not useful to the caller.
  return message.length > 300 ? `${message.slice(0, 300)}...` : message
}

/**
 * Run `task` for every item with at most `limit` in flight. The results keep
 * the input order, which makes the JSON response stable across runs.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0

  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await task(items[index])
      }
    }),
  )

  return results
}

type TargetOutcome =
  | { kind: 'uploaded'; pathname: string }
  | { kind: 'skipped'; pathname: string }
  | { kind: 'failed'; pathname: string; error: string }

export type RunMediaBackfillOptions = {
  docs: MediaBackfillDocument[]
  source: string
  token: string
  store: MediaBackfillStore
  fetchImpl: typeof fetch
  dryRun?: boolean
  perFileTimeoutMs?: number
  concurrency?: number
}

/**
 * Idempotent backfill: a file already present in the store is skipped, a
 * missing original is uploaded, and a size variant the source does not serve is
 * simply reported as skipped. A dry run performs the store lookups (reads only)
 * and reports what it would upload without fetching or writing bytes.
 */
export async function runMediaBackfill({
  docs,
  source,
  token,
  store,
  fetchImpl,
  dryRun = false,
  perFileTimeoutMs = 10_000,
  concurrency = 3,
}: RunMediaBackfillOptions): Promise<MediaBackfillResult> {
  const targets: MediaBackfillTarget[] = []
  const seen = new Set<string>()
  const unsafe: TargetOutcome[] = []

  for (const doc of docs) {
    for (const target of mediaBackfillTargets(doc)) {
      if (seen.has(target.pathname)) {
        continue
      }
      seen.add(target.pathname)

      if (!isSafePathname(target.pathname)) {
        unsafe.push({
          kind: 'failed',
          pathname: target.pathname,
          error: 'The media filename is not a safe blob pathname.',
        })
        continue
      }

      targets.push(target)
    }
  }

  const results = await mapWithConcurrency(targets, concurrency, async (target) => {
    // One budget for the lookups, download and upload of this file, so a slow
    // source or store cannot hold the request open indefinitely.
    const signal = AbortSignal.timeout(perFileTimeoutMs)

    try {
      await store.head(target.pathname, { token, abortSignal: signal })
      return { kind: 'skipped', pathname: target.pathname } satisfies TargetOutcome
    } catch {
      // A missing blob is the normal case; any other lookup error is allowed to
      // surface from the upload that follows.
    }

    if (dryRun) {
      return { kind: 'uploaded', pathname: target.pathname } satisfies TargetOutcome
    }

    const url = `${source}/${encodeURIComponent(target.pathname)}`

    let response: Response
    try {
      response = await fetchImpl(url, { signal, cache: 'no-store' })
    } catch (error) {
      if (target.optional) {
        return { kind: 'skipped', pathname: target.pathname } satisfies TargetOutcome
      }
      return {
        kind: 'failed',
        pathname: target.pathname,
        error: errorMessage(error),
      } satisfies TargetOutcome
    }

    if (!response.ok) {
      if (target.optional) {
        // Old production uploads may predate a size. That is not a failure.
        return { kind: 'skipped', pathname: target.pathname } satisfies TargetOutcome
      }
      return {
        kind: 'failed',
        pathname: target.pathname,
        error: `The source answered ${response.status}.`,
      } satisfies TargetOutcome
    }

    let body: ArrayBuffer
    try {
      body = await response.arrayBuffer()
    } catch (error) {
      if (target.optional) {
        return { kind: 'skipped', pathname: target.pathname } satisfies TargetOutcome
      }
      return {
        kind: 'failed',
        pathname: target.pathname,
        error: errorMessage(error),
      } satisfies TargetOutcome
    }

    const contentType = response.headers.get('content-type') ?? undefined

    try {
      await store.put(target.pathname, body, {
        token,
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        ...(contentType ? { contentType } : {}),
        abortSignal: signal,
      })
      return { kind: 'uploaded', pathname: target.pathname } satisfies TargetOutcome
    } catch (error) {
      return {
        kind: 'failed',
        pathname: target.pathname,
        error: errorMessage(error),
      } satisfies TargetOutcome
    }
  })

  const uploaded: string[] = []
  const skipped: string[] = []
  const failed: Array<{ filename: string; error: string }> = []

  for (const result of [...unsafe, ...results]) {
    if (result.kind === 'uploaded') {
      uploaded.push(result.pathname)
    } else if (result.kind === 'skipped') {
      skipped.push(result.pathname)
    } else {
      failed.push({ filename: result.pathname, error: result.error })
    }
  }

  return { ok: failed.length === 0, uploaded, skipped, failed }
}
