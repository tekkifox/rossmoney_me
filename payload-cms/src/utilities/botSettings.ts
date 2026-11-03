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
  /**
   * An absent key means "no narrowing": the agent reports on every host it may
   * reach. An empty array is a different, invalid state and is never emitted.
   */
  host_scope?: string[]
  allow_content: boolean
  allow_runbooks: boolean
  bookstack: BotSettingsBookstack
}

/** One inbound source, shaped like a `NOTIFY_INBOUND_SOURCES` entry. */
export type BotSettingsSource = {
  name: string
  connected_account_id: string
  channel_id: string
  allowed_authors: string
  target: string
}

/**
 * One host the notification agent may probe, taken from the enabled ArchView
 * sources. `name` is the source's hostname and `sshPort` is its SSH port.
 */
export type BotSettingsHost = {
  name: string
  sshPort: number
}

export type BotSettingsResponse = {
  version: string
  targets: Record<string, BotSettingsTarget>
  sources: BotSettingsSource[]
  hosts: BotSettingsHost[]
}

/** The port used when a source does not set one. */
export const DEFAULT_SSH_PORT = 32

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

/**
 * An absent host list means no narrowing at all: the target reports on every
 * host the agent may reach. An empty list is a load-time failure for the agent
 * (`target host_scope must not be empty`), so a list that is present must hold
 * at least one hostname.
 */
export const validateHostScope = (value: unknown): string | true => {
  if (value === undefined || value === null) {
    return true
  }

  const hosts = Array.isArray(value) ? value : []

  if (hosts.length === 0) {
    return 'The agent refuses to load an empty host_scope list. Enter at least one hostname, or leave the field unset to report on every host.'
  }

  for (const entry of hosts) {
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

/** Discord ids are snowflakes: 1–32 digits, and nothing else. */
export const SNOWFLAKE_PATTERN = /^[0-9]{1,32}$/

export const validateChannelId = (value: unknown): string | true => {
  const id = stringOrEmpty(value)
  if (!id) {
    return 'Enter the Discord channel id (digits only).'
  }
  if (!SNOWFLAKE_PATTERN.test(id)) {
    return 'Enter the Discord channel id as 1–32 digits, for example 000000000000000000.'
  }
  return true
}

/**
 * Composio's id format is not ours to assume: any non-empty value without
 * whitespace is accepted, and the `ca_` prefix is not required.
 */
export const validateConnectedAccountId = (value: unknown): string | true => {
  const id = stringOrEmpty(value)
  if (!id) {
    return 'Enter the Composio connected account id.'
  }
  if (/\s/.test(id)) {
    return 'The Composio connected account id must not contain whitespace.'
  }
  return true
}

/**
 * With no allowed authors the inbound listener refuses to start, so an empty
 * list is rejected rather than treated as "nobody may use this source".
 */
export const validateAllowedAuthors = (value: unknown): string | true => {
  const authors = Array.isArray(value)
    ? value.map((author) => stringOrEmpty(author)).filter(Boolean)
    : []

  if (authors.length === 0) {
    return 'At least one Discord user id is required. With no allowed authors the inbound listener refuses to start.'
  }
  return true
}

/** The target row named `name`, compared exactly (it is a JSON key). */
export const findTargetByName = (targets: unknown, name: string): unknown =>
  (Array.isArray(targets) ? targets : [])
    .map((row) => asRecord(row))
    .find((row) => stringOrEmpty(row.name) === name)

/**
 * A source must listen on the same channel its target sends to; the agent
 * refuses to run otherwise ("refusing to send replies to a different channel").
 * An unknown target is left to the target-reference validator.
 */
export const validateSourceChannelMatchesTarget = (
  channelId: unknown,
  targetName: unknown,
  targets: unknown,
): string | true => {
  const name = stringOrEmpty(targetName)
  const channel = stringOrEmpty(channelId)
  if (!name || !channel) {
    return true
  }

  const target = findTargetByName(targets, name)
  if (!target) {
    return true
  }

  const targetChannel = stringOrEmpty(asRecord(target).channel_id)
  if (!targetChannel) {
    return true
  }

  if (channel !== targetChannel) {
    return `Source channel ${channel} does not match target "${name}" channel ${targetChannel}. The agent refuses to send replies to a different channel.`
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

/** Inbound source names follow the same key-safe pattern as target names. */
export const validateSourceName = validateTargetName

/** Target names defined in the same document, used by the source reference check. */
export const knownTargetNames = (targets: unknown): string[] =>
  (Array.isArray(targets) ? targets : [])
    .map((row) => stringOrEmpty(asRecord(row).name))
    .filter(Boolean)

/**
 * A source must name a target that exists in this same document.
 *
 * The lookup is case-sensitive on purpose: the agent keys `targets` by name, so
 * `Admin-Chat` would pass a case-insensitive check and still answer to nothing.
 * The error names the value it could not find, which is the typo an editor has
 * to fix.
 */
export const validateSourceTarget = (value: unknown, targets: unknown): string | true => {
  if (isBlank(value)) {
    return true
  }
  const name = stringOrEmpty(value)
  if (!name) {
    return true
  }

  if (!knownTargetNames(targets).includes(name)) {
    return `Target "${name}" does not exist. Add it under Targets first, or correct the name: a source that names a missing target answers to nothing.`
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

/** Names that appear more than once, compared case-insensitively (targets or sources). */
export const duplicateNames = (rows: unknown): string[] => {
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
 * keyed by name and `sources` is an array, using the snake_case field names of
 * the old `NOTIFY_TARGETS` / `NOTIFY_INBOUND_SOURCES` variables. Nothing else is
 * exposed.
 */
export const toBotSettingsResponse = (
  doc: unknown,
  sourceRows: unknown = [],
): BotSettingsResponse | null => {
  const global = asRecord(doc)
  const version = asString(global.updatedAt)
  if (!version) {
    return null
  }

  const targets = toTargets(global.targets)
  return {
    version,
    targets,
    sources: toSources(global.sources),
    hosts: toHosts(sourceRows),
  }
}

/**
 * Turns the enabled ArchView sources into the host-to-port list the notification
 * agent consumes. The source's `name` is its hostname, and an empty `sshPort`
 * keeps working as the fleet default of 32. A source without a name is skipped
 * rather than emitted with an empty name.
 */
const toHosts = (rows: unknown): BotSettingsHost[] => {
  const hosts: BotSettingsHost[] = []

  for (const row of Array.isArray(rows) ? rows : []) {
    const source = asRecord(row)
    const name = stringOrEmpty(source.name)
    if (!name) {
      continue
    }
    hosts.push({ name, sshPort: toSshPort(source.sshPort) })
  }

  return hosts.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )
}

const toSshPort = (value: unknown): number => {
  if (isBlank(value)) {
    return DEFAULT_SSH_PORT
  }

  const port = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // The field rejects this, so a stored value that gets here is defensive.
    return DEFAULT_SSH_PORT
  }
  return port
}

const toTargets = (rows: unknown): Record<string, BotSettingsTarget> => {
  const targets: Record<string, BotSettingsTarget> = {}

  for (const row of Array.isArray(rows) ? rows : []) {
    const target = asRecord(row)
    const name = stringOrEmpty(target.name)
    if (!name) {
      continue
    }

    const bookstack = asRecord(target.bookstack)
    // The agent treats an absent host_scope as "no narrowing" and refuses an
    // empty list, so only a non-empty list is emitted. A scope-less target must
    // not turn into `host_scope: []`.
    const hostScope = Array.isArray(target.host_scope)
      ? target.host_scope.map((host) => stringOrEmpty(host)).filter(Boolean)
      : []

    const entry: BotSettingsTarget = {
      channel_id: stringOrEmpty(target.channel_id),
      connected_account_id: stringOrEmpty(target.connected_account_id),
      ...(hostScope.length > 0 ? { host_scope: hostScope } : {}),
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

  return targets
}

/**
 * `allowed_authors` is a comma-separated string in the agent's environment
 * variable, so an empty list becomes `''` — the agent then refuses every author.
 */
const toSources = (rows: unknown): BotSettingsSource[] => {
  const sources: BotSettingsSource[] = []

  for (const row of Array.isArray(rows) ? rows : []) {
    const source = asRecord(row)
    const name = stringOrEmpty(source.name)
    if (!name) {
      continue
    }

    sources.push({
      name,
      connected_account_id: stringOrEmpty(source.connected_account_id),
      channel_id: stringOrEmpty(source.channel_id),
      allowed_authors: Array.isArray(source.allowed_authors)
        ? source.allowed_authors
            .map((author) => stringOrEmpty(author))
            .filter(Boolean)
            .join(',')
        : '',
      target: stringOrEmpty(source.target),
    })
  }

  return sources
}

