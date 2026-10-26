/**
 * Shared, dependency-free helpers for the in-house error log.
 *
 * This module is imported by the public error-report endpoint, the server-side
 * instrumentation hook, the client reporter and the Payload collection, so it
 * must stay free of Node-only APIs and of Payload itself. Keeping the scrubbing
 * and fingerprinting here means every entry point applies exactly the same
 * rules and the rules can be unit-tested without a database.
 */

import { redactInternalEndpoints } from './redactInternalEndpoints'

/** Bounded so an error loop or a bot cannot grow the CMS database. */
export const ERROR_LOG_LIMITS = {
  /** Rows kept in the collection. The oldest are deleted on write. */
  maxRows: 2_000,
  /** Repeated fingerprints inside this window increment `occurrences`. */
  dedupWindowMs: 60 * 60 * 1_000,
  /** Request body ceiling for `POST /api/error-report`. */
  maxPayloadBytes: 16 * 1_024,
  message: 2_000,
  stack: 8_000,
  route: 500,
  url: 1_000,
  userAgent: 500,
  environment: 100,
  release: 100,
} as const

export type ErrorLogLevel = 'warning' | 'error' | 'fatal'
export type ErrorLogSource = 'client' | 'react' | 'server'

export type ErrorReportInput = {
  level?: string
  message?: string
  stack?: string
  /** Pathname, ideally. Query strings are discarded before storage. */
  route?: string
  /** Full page or request URL. Query strings are discarded before storage. */
  url?: string
  source?: string
  environment?: string
  release?: string
  userAgent?: string
  timestamp?: string | Date
}

export type NormalisedErrorReport = {
  level: ErrorLogLevel
  message: string
  stack: string
  route: string
  url: string
  source: ErrorLogSource
  environment: string
  release: string
  userAgent: string
  timestamp: Date
  fingerprint: string
}

/**
 * Header/field values that must never reach the log. Order matters: the most
 * specific shapes (database URLs, bearer tokens) are replaced before the generic
 * `key=value` rule runs, so a half-redacted value cannot survive.
 */
const DATABASE_URL = /\bmongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi
const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi
const COOKIE_HEADER = /\b(set-cookie|cookie)\s*:\s*[^\r\n]*/gi
const SECRET_ASSIGNMENT =
  /\b(authorization|proxy-authorization|password|passwd|pwd|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|session[_-]?id)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi
// Common hosted-service token shapes (Resend, Stripe, GitHub, webhooks).
const KNOWN_TOKEN = /\b(?:sk|pk|rk|re|whsec|ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_-]{12,}\b/g
const URL_USERINFO = /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@/gi
const PRIVATE_IPV4 =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g

/**
 * Docker service names that must not be stored. The list mirrors the services
 * this stack actually runs; `redactInternalEndpoints` below also catches any
 * other single-label host that appears inside an http(s) URL.
 *
 * Matching is case-sensitive on purpose: the brand "MongoDB" in an error
 * message should stay readable, while the lowercase Docker service name
 * ("mongo:27017") is redacted.
 */
const INTERNAL_HOSTS = [
  'socket-proxy',
  'archview',
  'mongo',
  'mongodb',
  'redis',
  'portainer',
  'payload-cms',
  'traefik',
] as const
const INTERNAL_HOST = new RegExp(
  `\\b(?:${INTERNAL_HOSTS.join('|')}|localhost)(?::\\d{2,5})?\\b`,
  'g',
)
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g

const asString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

/** Trim by code points so a truncation cannot split an emoji in half. */
export const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }
  return Array.from(value).slice(0, maxLength).join('')
}

/**
 * Remove credentials, session material, database URLs, private addresses and
 * internal hostnames, then cap the result. Everything that is stored or sent
 * passes through here.
 */
export function scrubErrorText(value: string, maxLength: number): string {
  const cleaned = asString(value)
    .replace(CONTROL_CHARACTERS, '')
    .replace(DATABASE_URL, '[redacted-database-url]')
    .replace(AUTH_SCHEME, '$1 [redacted]')
    .replace(COOKIE_HEADER, '$1: [redacted]')
    .replace(SECRET_ASSIGNMENT, '$1$2[redacted]')
    .replace(KNOWN_TOKEN, '[redacted-token]')
    .replace(URL_USERINFO, 'https://[redacted]@')
    .replace(PRIVATE_IPV4, '[internal-ip]')
    .replace(INTERNAL_HOST, '[internal-host]')

  // Single-label hosts inside a URL that are not in the list above.
  const withoutInternalUrls = redactInternalEndpoints(cleaned)

  return truncate(withoutInternalUrls.trim(), maxLength)
}

/** Path only: avoids storing search parameters and fragments at all. */
export function pathFromUrl(value: string): string {
  const trimmed = asString(value).trim()
  if (!trimmed) {
    return ''
  }

  try {
    const parsed = new URL(trimmed, 'http://error-log.invalid')
    return parsed.pathname || '/'
  } catch {
    return trimmed.split(/[?#]/)[0] || ''
  }
}

/** Absolute URL with no query or fragment; relative input stays a path. */
export function urlWithoutQuery(value: string): string {
  const trimmed = asString(value).trim()
  if (!trimmed) {
    return ''
  }

  try {
    const parsed = new URL(trimmed, 'http://error-log.invalid')
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? `${parsed.origin}${parsed.pathname}`
      : parsed.pathname
  } catch {
    return trimmed.split(/[?#]/)[0] || ''
  }
}

const normaliseLevel = (value: unknown): ErrorLogLevel => {
  const level = asString(value).toLowerCase()
  if (level === 'warning' || level === 'warn') {
    return 'warning'
  }
  if (level === 'fatal' || level === 'critical') {
    return 'fatal'
  }
  return 'error'
}

const normaliseSource = (value: unknown): ErrorLogSource => {
  const source = asString(value).toLowerCase()
  if (source === 'server') {
    return 'server'
  }
  if (source === 'react') {
    return 'react'
  }
  return 'client'
}

/** Ignore a client-supplied clock that is clearly wrong (dedup-window abuse). */
const normaliseTimestamp = (value: unknown, now: Date): Date => {
  if (value instanceof Date) {
    const time = value.getTime()
    if (Number.isFinite(time) && Math.abs(time - now.getTime()) <= 10 * 60 * 1_000) {
      return value
    }
    return now
  }

  if (typeof value === 'string' && value.trim()) {
    const time = Date.parse(value)
    if (Number.isFinite(time) && Math.abs(time - now.getTime()) <= 10 * 60 * 1_000) {
      return new Date(time)
    }
  }

  return now
}

const fnv1a = (input: string, seed: number): string => {
  let hash = seed >>> 0
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Short stable fingerprint used to group repeats. Numbers, UUIDs, hex addresses
 * and quoted values are normalised first so the same bug with different ids is
 * counted once.
 */
export function fingerprintError(report: {
  level: ErrorLogLevel
  message: string
  route: string
  source: ErrorLogSource
}): string {
  const normalisedMessage = report.message
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/\b\d{2,}\b/g, '<n>')
    .replace(/"[^"]*"/g, '"<value>"')
    .replace(/'[^']*'/g, "'<value>'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)

  const input = `${report.level}|${report.source}|${report.route}|${normalisedMessage}`
  return `${fnv1a(input, 0x811c9dc5)}${fnv1a(input, 0x01000193)}`
}

/**
 * Coerce an untrusted payload into the row shape. Returns `null` when there is
 * no usable message. Scrub caps are applied here, before anything is stored.
 */
export function normaliseErrorReport(
  input: unknown,
  now: Date = new Date(),
): NormalisedErrorReport | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const raw = input as Record<string, unknown>
  const message = scrubErrorText(asString(raw.message), ERROR_LOG_LIMITS.message)
  if (!message) {
    return null
  }

  const level = normaliseLevel(raw.level)
  const source = normaliseSource(raw.source)
  const route =
    scrubErrorText(
      pathFromUrl(asString(raw.route) || asString(raw.url)),
      ERROR_LOG_LIMITS.route,
    ) || '/'
  const url =
    scrubErrorText(
      urlWithoutQuery(asString(raw.url) || asString(raw.route)),
      ERROR_LOG_LIMITS.url,
    ) || route

  const report = {
    level,
    source,
    message,
    route,
    url,
    stack: scrubErrorText(asString(raw.stack), ERROR_LOG_LIMITS.stack),
    environment:
      scrubErrorText(asString(raw.environment), ERROR_LOG_LIMITS.environment) || 'unknown',
    release: scrubErrorText(asString(raw.release), ERROR_LOG_LIMITS.release) || 'unknown',
    userAgent: scrubErrorText(asString(raw.userAgent), ERROR_LOG_LIMITS.userAgent),
    timestamp: normaliseTimestamp(raw.timestamp, now),
  }

  return {
    ...report,
    fingerprint: fingerprintError(report),
  }
}
