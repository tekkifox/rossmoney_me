import type { Payload } from 'payload'

import type { ArchviewSourceCredentials } from './archviewAuth'
import { asString } from './json'

type SourceRow = Record<string, unknown>

const readRequired = (row: SourceRow, name: string): string | null => {
  const value = asString(row[name])
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * Narrows a stored row to the credentials the proxy needs.
 *
 * `afterRead` has already decrypted `clientSecret` for local API reads; a row
 * with any missing part is treated as unusable rather than sent half-formed.
 */
export const toArchviewSourceCredentials = (
  row: unknown,
): ArchviewSourceCredentials | null => {
  if (typeof row !== 'object' || row === null) {
    return null
  }

  const record = row as SourceRow
  const origin = readRequired(record, 'origin')
  const audience = readRequired(record, 'audience')
  const tokenUrl = readRequired(record, 'tokenUrl')
  const clientId = readRequired(record, 'clientId')
  const clientSecret = asString(record.clientSecret)

  if (!origin || !audience || !tokenUrl || !clientId || !clientSecret) {
    return null
  }

  return {
    origin,
    audience,
    tokenUrl,
    clientId,
    clientSecret,
    scope: readRequired(record, 'scope') ?? 'archview:read',
  }
}

/**
 * Finds the enabled collection row for `origin`.
 *
 * The local API's `overrideAccess` is deliberate: the row is needed
 * server-side, while the field access rule keeps the secret out of every API
 * response. Disabled rows are filtered in the query so a stale credential is
 * never used.
 */
export const findEnabledArchviewSource = async (
  payload: Payload,
  origin: string,
): Promise<ArchviewSourceCredentials | null> => {
  const result = await payload.find({
    collection: 'archview-sources',
    context: { revealArchviewSourceSecret: true },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [{ origin: { equals: origin } }, { enabled: { equals: true } }],
    },
  })

  return toArchviewSourceCredentials(result.docs[0])
}
