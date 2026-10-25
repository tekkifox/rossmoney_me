// Helpers for handling opaque JSON (CMS `json` fields, third-party API payloads).
//
// Values coming from JSON are genuinely unknown until narrowed. These helpers
// keep that boundary honest without sprinkling `any` through the call sites.

/** Anything that can be indexed with string keys, including arrays (which JS indexes numerically). */
export type JsonRecord = Record<string, unknown>

/**
 * True for any non-null object, including arrays. Object access on arrays simply
 * yields `undefined` for string keys, which matches how the JSON payloads were
 * previously accessed after a cast.
 */
export function isObjectLike(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

/** Returns the value when it is an object, otherwise an empty object. */
export function asRecord(value: unknown): JsonRecord {
  return isObjectLike(value) ? value : {}
}

/** Returns a string for string/number/boolean input and `undefined` for nullish input. */
export function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/** First value in the list that is not `null`, `undefined` or an empty string. */
export function firstPresent(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}
