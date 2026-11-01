import { asRecord, asString } from './json'

/**
 * Validation and shaping for the `bot-settings` global.
 *
 * The notification bot reads this configuration through `GET /api/bot-settings`.
 * Its credentials do not live here: `bookstack.token` is the *name* of a
 * Portainer environment variable, never the credential itself. The CMS database
 * is replicated, cloned to preview and backed up nightly, so a token stored here
 * would leak to all three. The name pattern below is the enforcement point.
 */

/** Letters, digits and underscores, at most 32 characters. Nothing else. */
export const BOOKSTACK_CREDENTIAL_NAME_PATTERN = /^[A-Za-z0-9_]{1,32}$/

/** Slugs or ids, comma separated. More than this is a configuration mistake. */
export const BOOKSTACK_MAX_BOOKS = 16

/** Target names become keys in the JSON the bot parses. */
export const TARGET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** A hostname: no scheme, path, port, wildcard or whitespace. */
export const HOSTNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/

/** A BookStack slug, for example `runbooks` or `v-rising`. */
const BOOK_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/

/** A BookStack numeric id, for example `12`. */
const BOOK_ID_PATTERN = /^[1-9]\d*$/

export type BotSettingsBookstack = {
  url?: string
  books?: string
  token?: string
}

export type BotSettingsTarget = {
  channel_id: string
  connected_account_id: string
  host_scope: string[]
  allow_content: boolean
  allow_runbooks: boolean
  bookstack: BotSettingsBookstack
}

export type BotSettingsResponse = {
  version: string
  targets: Record<string, BotSettingsTarget>
}

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || value === ''

const stringOrEmpty = (value: unknown): string => asString(value)?.trim() ?? ''

/** Splits the comma-separated `books` value into trimmed entries. */
export const splitBookstackBooks = (value: unknown): string[] =>
  typeof value === 'string' ? value.split(',').map((entry) => entry.trim()) : []

/**
 * The credential field stores a *name* — `vortex`, `operator` — which the agent
 * resolves to `BOOKSTACK_TOKEN_*_<NAME>` inside Portainer. A pasted BookStack or
 * Composio token contains characters a name cannot (or is longer than 32
 * characters), so it is rejected here rather than stored and backed up.
 */
export const validateCredentialName = (value: unknown): string | true => {
  if (isBlank(value)) {
    return true
  }
  if (typeof value !== 'string' || !BOOKSTACK_CREDENTIAL_NAME_PATTERN.test(value)) {
    return 'Enter the credential NAME only, up to 32 letters, digits or underscores (for example vortex). Never paste the token itself: tokens stay in Portainer.'
  }
  return true
}

export const validateBookstackUrl = (value: unknown): string | true => {
  if (isBlank(value)) {
    return true
  }
  if (typeof value !== 'string') {
    return 'Enter the BookStack URL, for example https://bookstack.example.com'
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Enter an absolute https:// URL, for example https://bookstack.example.com'
  }

  if (url.protocol !== 'https:') {
    return 'The BookStack URL must use https://'
  }
  if (url.username || url.password) {
    return 'The BookStack URL must not contain credentials'
  }
  return true
}

export const validateBookstackBooks = (value: unknown): string | true => {
  if (isBlank(value)) {
    return true
  }
  if (typeof value !== 'string') {
    return 'Enter the books as a comma-separated list of slugs or ids.'
  }

  const entries = splitBookstackBooks(value)
  if (entries.some((entry) => entry === '')) {
    return 'Every book entry must be a slug or a positive integer. Remove the empty entry.'
  }
  if (entries.length > BOOKSTACK_MAX_BOOKS) {
    return `At most ${BOOKSTACK_MAX_BOOKS} books are allowed.`
  }

  const invalid = entries.find(
    (entry) => !BOOK_ID_PATTERN.test(entry) && !BOOK_SLUG_PATTERN.test(entry),
  )
  if (invalid) {
    return `"${invalid}" is not a book slug or positive integer. Separate entries with commas and use no other characters or whitespace.`
  }
  return true
}

export const validateHostScope = (value: unknown): string | true => {
  if (isBlank(value)) {
    return true
  }
  if (!Array.isArray(value)) {
    return 'Enter the hosts as a list.'
  }

  for (const entry of value) {
    const host = stringOrEmpty(entry)
    if (!host) {
      return 'Every host entry must be a hostname, for example example.com'
    }
    if (!HOSTNAME_PATTERN.test(host) || host.includes('..')) {
      return `"${host}" is not a hostname. Enter it without a scheme, path or port, for example example.com`
    }
  }
  return true
}

export const validateTargetName = (value: unknown): string | true => {
  if (isBlank(value)) {
    return true
  }
  const name = typeof value === 'string' ? value.trim() : ''
  if (!TARGET_NAME_PATTERN.test(name)) {
    return 'Use letters, digits, hyphens or underscores, starting with a letter or digit (for example admin-chat).'
  }
  return true
}

/**
 * The two cross-field runbook rules:
 * - a URL present means the target may read runbooks;
 * - reading runbooks needs a URL, books and a credential name.
 *
 * Reading `siblingData` lets the error sit on the checkbox that decides the
 * rule, which is where an editor looks first.
 */
export const validateRunbookAccess = (
  allowRunbooks: boolean,
  bookstack: unknown,
): string | true => {
  const group = asRecord(bookstack)
  const url = stringOrEmpty(group.url)
  const books = stringOrEmpty(group.books)
  const token = stringOrEmpty(group.token)

  if (allowRunbooks) {
    if (!url) return 'Allow runbooks needs a BookStack URL.'
    if (!books) return 'Allow runbooks needs the BookStack books this target may read.'
    if (!token) return 'Allow runbooks needs a BookStack credential name.'
    return true
  }

  if (url) {
    return 'A BookStack URL is only allowed when "Allow runbooks" is ticked.'
  }
  return true
}

/** Names that appear more than once, compared case-insensitively. */
export const duplicateTargetNames = (rows: unknown): string[] => {
  if (!Array.isArray(rows)) {
    return []
  }

  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    const name = stringOrEmpty(asRecord(row).name).toLowerCase()
    if (!name) {
      continue
    }
    if (seen.has(name)) {
      duplicates.add(name)
    } else {
      seen.add(name)
    }
  }
  return [...duplicates]
}

/**
 * Converts the stored global into the shape the agent consumes: `targets` is
 * keyed by name and every entry uses the snake_case field names of the old
 * `NOTIFY_TARGETS` environment variable. Nothing else is exposed.
 */
export const toBotSettingsResponse = (doc: unknown): BotSettingsResponse | null => {
  const global = asRecord(doc)
  const version = asString(global.updatedAt)
  if (!version) {
    return null
  }

  const rows = Array.isArray(global.targets) ? global.targets : []
  const targets: Record<string, BotSettingsTarget> = {}

  for (const row of rows) {
    const target = asRecord(row)
    const name = stringOrEmpty(target.name)
    if (!name) {
      continue
    }

    const bookstack = asRecord(target.bookstack)
    const entry: BotSettingsTarget = {
      channel_id: stringOrEmpty(target.channel_id),
      connected_account_id: stringOrEmpty(target.connected_account_id),
      host_scope: Array.isArray(target.host_scope)
        ? target.host_scope.map((host) => stringOrEmpty(host)).filter(Boolean)
        : [],
      allow_content: target.allow_content === true,
      allow_runbooks: target.allow_runbooks === true,
      bookstack: {},
    }

    for (const key of ['url', 'books', 'token'] as const) {
      const value = stringOrEmpty(bookstack[key])
      if (value) {
        entry.bookstack[key] = value
      }
    }

    targets[name] = entry
  }

  return { version, targets }
}
