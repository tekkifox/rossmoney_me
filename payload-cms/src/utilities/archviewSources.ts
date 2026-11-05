import type { Payload, Where } from 'payload'

import type { ArchviewSourceCredentials } from './archviewAuth'
import {
  ArchviewSecretError,
  canDecryptArchviewSecrets,
} from './archviewSourceSecret'
import { asString } from './json'

type SourceRow = Record<string, unknown>

/**
 * An enabled source row. `credentials` is absent for an anonymous source (for
 * example the seeded Vortexservers row) or one whose credentials are
 * incomplete.
 */
export type ArchviewSourceRecord = {
  id?: string
  name?: string
  origin: string
  project?: string
  credentials?: ArchviewSourceCredentials
}

const readRequired = (row: SourceRow, name: string): string | null => {
  const value = asString(row[name])
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const readCredentials = (row: SourceRow): ArchviewSourceCredentials | undefined => {
  const origin = readRequired(row, 'origin')
  const audience = readRequired(row, 'audience')
  const tokenUrl = readRequired(row, 'tokenUrl')
  const clientId = readRequired(row, 'clientId')
  const clientSecret = readRequired(row, 'clientSecret')

  if (!origin || !audience || !tokenUrl || !clientId || !clientSecret) {
    return undefined
  }

  return {
    origin,
    audience,
    tokenUrl,
    clientId,
    clientSecret,
    scope: readRequired(row, 'scope') ?? 'archview:read',
  }
}

/**
 * Narrows a stored row to what the proxy and page resolver need.
 *
 * `afterRead` decrypts `clientSecret` when the read asks for it. The secret is
 * optional so a source can exist anonymously until an admin fills it in.
 */
export const toArchviewSourceRecord = (row: unknown): ArchviewSourceRecord | null => {
  if (typeof row !== 'object' || row === null) {
    return null
  }

  const record = row as SourceRow
  const origin = readRequired(record, 'origin')
  if (!origin) {
    return null
  }

  const id = asString(record.id)
  const name = readRequired(record, 'name') ?? undefined
  const project = readRequired(record, 'project') ?? undefined
  const credentials = readCredentials(record)
  const base = {
    origin,
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(project ? { project } : {}),
  }
  return credentials ? { ...base, credentials } : base
}

let warnedMissingSecretKey = false

const warnCredentialsUnavailable = (reason: string): void => {
  if (warnedMissingSecretKey) {
    return
  }
  warnedMissingSecretKey = true
  console.warn(
    `ArchView source credentials are unavailable (${reason}); reading sources without stored secrets.`,
  )
}

const isSecretError = (error: unknown): boolean => {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (current instanceof ArchviewSecretError) {
      return true
    }
    const record = current as { name?: unknown; message?: unknown; cause?: unknown }
    if (record.name === 'ArchviewSecretError') {
      return true
    }
    const message = typeof record.message === 'string' ? record.message : ''
    if (message.includes('ARCHVIEW_SECRET_KEY') || message.includes('client secret')) {
      return true
    }
    current = record.cause
  }
  return false
}

/**
 * Looks up one enabled row.
 *
 * The local API's `overrideAccess` and context are deliberate: the row is
 * needed server-side, while `afterRead` keeps the secret out of every response
 * that does not ask for it. Disabled rows are filtered in the query so a stale
 * credential is never used.
 *
 * A missing or invalid `ARCHVIEW_SECRET_KEY` must not make the source look
 * disabled, deleted or malformed: the origin, project and id are enough to
 * fetch anonymously or to key the cached snapshot. Only the credentials are
 * dropped, with a warning, when they cannot be decrypted.
 */
const findEnabledSourceRecord = async (
  payload: Payload,
  where: Where,
): Promise<ArchviewSourceRecord | null> => {
  const query = (revealSecret: boolean) =>
    payload.find({
      collection: 'archview-sources',
      ...(revealSecret ? { context: { revealArchviewSourceSecret: true } } : {}),
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        and: [where, { enabled: { equals: true } }],
      },
    })

  const canReveal = canDecryptArchviewSecrets()
  if (!canReveal) {
    warnCredentialsUnavailable('ARCHVIEW_SECRET_KEY is not set or is not valid')
  }

  let result
  try {
    result = await query(canReveal)
  } catch (error) {
    // A valid key with an unreadable stored value also fails closed. The row
    // itself is still usable, so retry without asking `afterRead` to decrypt.
    if (!isSecretError(error)) {
      throw error
    }
    warnCredentialsUnavailable(
      error instanceof Error ? error.message : 'stored secret could not be decrypted',
    )
    result = await query(false)
  }

  return toArchviewSourceRecord(result.docs[0])
}

export const findEnabledArchviewSourceRecord = (
  payload: Payload,
  origin: string,
): Promise<ArchviewSourceRecord | null> =>
  findEnabledSourceRecord(payload, { origin: { equals: origin } })

export const findEnabledArchviewSourceRecordById = async (
  payload: Payload,
  id: string,
): Promise<ArchviewSourceRecord | null> => {
  try {
    return await findEnabledSourceRecord(payload, { id: { equals: id } })
  } catch {
    // A non-ID value (for example a malformed source parameter) must not turn
    // into a database error on the proxy path.
    return null
  }
}

/** The row used by pages that do not name a source. */
export const findDefaultArchviewSourceRecord = (
  payload: Payload,
): Promise<ArchviewSourceRecord | null> =>
  findEnabledSourceRecord(payload, { isDefault: { equals: true } })

/**
 * Resolves a `source` value that may be either an origin or a document ID.
 * Both go through the same enabled-row lookup.
 */
export const findEnabledArchviewSourceRecordByRef = async (
  payload: Payload,
  ref: string,
): Promise<ArchviewSourceRecord | null> => {
  const value = ref.trim()
  if (!value) {
    return null
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      return await findEnabledArchviewSourceRecord(payload, new URL(value).origin)
    } catch {
      return null
    }
  }

  return findEnabledArchviewSourceRecordById(payload, value)
}

/** Credential-only view used by the token layer. */
export const findEnabledArchviewSource = async (
  payload: Payload,
  origin: string,
): Promise<ArchviewSourceCredentials | null> =>
  (await findEnabledArchviewSourceRecord(payload, origin))?.credentials ?? null

export const findEnabledArchviewSourceByRef = async (
  payload: Payload,
  ref: string,
): Promise<ArchviewSourceCredentials | null> =>
  (await findEnabledArchviewSourceRecordByRef(payload, ref))?.credentials ?? null

export const findDefaultArchviewSource = async (
  payload: Payload,
): Promise<ArchviewSourceCredentials | null> =>
  (await findDefaultArchviewSourceRecord(payload))?.credentials ?? null
