import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as botSettingsRoute from '@/app/api/bot-settings/route'
import { GET } from '@/app/api/bot-settings/route'
import type { BotSetting } from '@/payload-types'
import config from '@/payload.config'
import { BOT_SETTINGS_SEED, seedBotSettings } from '@/endpoints/seed/bot-settings'
import {
  duplicateTargetNames,
  splitBookstackBooks,
  toBotSettingsResponse,
  validateBookstackBooks,
  validateBookstackUrl,
  validateCredentialName,
  validateHostScope,
  validateRunbookAccess,
} from '@/utilities/botSettings'

type Target = NonNullable<BotSetting['targets']>[number]

const BOT_EMAIL = 'notification-bot@example.test'
const BOT_API_KEY = 'notification-bot-test-key'

let payload: Payload

const request = (headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/api/bot-settings', { headers })

const baseTarget = (): Target => ({
  name: 'admin-chat',
  channel_id: '000000000000000000',
  connected_account_id: 'ca_exampleconnection',
  host_scope: ['host1.example.com'],
  allow_content: false,
  allow_runbooks: true,
  bookstack: {
    url: 'https://bookstack.example.com',
    books: 'v-rising,scripts',
    token: 'vortex',
  },
})

const saveTargets = (targets: Target[]) =>
  payload.updateGlobal({
    slug: 'bot-settings',
    data: { targets },
    depth: 0,
    overrideAccess: true,
  })

describe('GET /api/bot-settings', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    const existing = await payload.find({
      collection: 'users',
      where: { email: { equals: BOT_EMAIL } },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      await payload.update({
        collection: 'users',
        id: existing.docs[0].id,
        data: { apiKey: BOT_API_KEY },
        overrideAccess: true,
      })
    } else {
      await payload.create({
        collection: 'users',
        data: {
          email: BOT_EMAIL,
          password: 'not-a-real-password',
          name: 'Notification bot',
          apiKey: BOT_API_KEY,
        },
        overrideAccess: true,
      })
    }
  })

  afterAll(async () => {
    // The rejection cases leave the stored document untouched, but the accepted
    // save below replaces it; put the real configuration back for later specs.
    await seedBotSettings(payload, true)
  })

  it('rejects an unauthenticated request with 401 and no data', async () => {
    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body).toEqual({ errors: [{ message: 'Unauthorized' }] })
    expect(JSON.stringify(body)).not.toContain('admin-chat')
  })

  it('rejects an unknown API key with 401', async () => {
    const response = await GET(
      request({ Authorization: 'users API-Key not-the-right-key' }),
    )

    expect(response.status).toBe(401)
  })

  it('returns the seeded targets keyed by name to an API-key caller', async () => {
    const response = await GET(
      request({ Authorization: `users API-Key ${BOT_API_KEY}` }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['targets', 'version'])
    expect(Object.keys(body.targets).sort()).toEqual(['admin-chat', 'automations'])
    expect(Number.isNaN(Date.parse(body.version))).toBe(false)

    for (const target of BOT_SETTINGS_SEED.targets) {
      const { name, ...expected } = target
      expect(body.targets[name]).toEqual(expected)
    }

    // Only the resolved shape is exposed: no row ids, timestamps or credentials.
    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain('apiKey')
    expect(serialised).not.toContain('"id"')
    expect(serialised).not.toContain('createdAt')
  })

  it('exposes a GET handler only', () => {
    expect(typeof botSettingsRoute.GET).toBe('function')
    expect('POST' in botSettingsRoute).toBe(false)
    expect('PUT' in botSettingsRoute).toBe(false)
    expect('PATCH' in botSettingsRoute).toBe(false)
    expect('DELETE' in botSettingsRoute).toBe(false)
  })
})

describe('bot-settings schema validation', () => {
  beforeAll(async () => {
    if (!payload) {
      payload = await getPayload({ config: await config })
    }
  })

  it('saves the seeded configuration', async () => {
    await expect(saveTargets(BOT_SETTINGS_SEED.targets as Target[])).resolves.toBeTruthy()
  })

  it('rejects a credential that looks like a real token', async () => {
    const target = baseTarget()
    target.bookstack = { ...target.bookstack, token: 'Token 4f9a6c1b:7d2e0a93' }

    await expect(saveTargets([target])).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects a credential name longer than 32 characters', async () => {
    const target = baseTarget()
    target.bookstack = { ...target.bookstack, token: 'a'.repeat(33) }

    await expect(saveTargets([target])).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects runbooks without a URL, books and credential name', async () => {
    const target: Target = {
      ...baseTarget(),
      bookstack: {},
    }

    await expect(saveTargets([target])).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects a BookStack URL that is not https', async () => {
    const target = baseTarget()
    target.bookstack = { ...target.bookstack, url: 'http://bookstack.example.com' }

    await expect(saveTargets([target])).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects a BookStack URL when runbooks are not allowed', async () => {
    const target: Target = { ...baseTarget(), allow_runbooks: false }

    await expect(saveTargets([target])).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects more than 16 books', async () => {
    const books = Array.from({ length: 17 }, (_, index) => `book-${index}`).join(',')
    const target = baseTarget()
    target.bookstack = { ...target.bookstack, books }

    await expect(saveTargets([target])).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects a book entry containing whitespace', async () => {
    const target = baseTarget()
    target.bookstack = { ...target.bookstack, books: 'v-rising,not a slug' }

    await expect(saveTargets([target])).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects duplicate target names', async () => {
    const second: Target = {
      ...baseTarget(),
      name: 'admin-chat',
      channel_id: '000000000000000001',
    }

    await expect(saveTargets([baseTarget(), second])).rejects.toMatchObject({
      name: 'ValidationError',
    })
  })
})

describe('bot-settings validators', () => {
  it('accepts credential names and rejects anything token-shaped', () => {
    expect(validateCredentialName('vortex')).toBe(true)
    expect(validateCredentialName('operator')).toBe(true)
    expect(validateCredentialName('OPS_2')).toBe(true)
    expect(validateCredentialName(null)).toBe(true)

    expect(validateCredentialName('Token 4f9a6c1b:7d2e0a93')).not.toBe(true)
    expect(validateCredentialName('vortex-token')).not.toBe(true)
    expect(validateCredentialName('a'.repeat(33))).not.toBe(true)
    expect(validateCredentialName(' vortex ')).not.toBe(true)
    expect(validateCredentialName('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0')).not.toBe(true)
  })

  it('accepts slugs and ids, and rejects malformed book lists', () => {
    expect(validateBookstackBooks('v-rising,scripts')).toBe(true)
    expect(validateBookstackBooks('runbooks, 12')).toBe(true)
    expect(validateBookstackBooks('')).toBe(true)
    expect(validateBookstackBooks(null)).toBe(true)

    expect(validateBookstackBooks('v-rising,,scripts')).not.toBe(true)
    expect(validateBookstackBooks('v rising')).not.toBe(true)
    expect(validateBookstackBooks('book.one')).not.toBe(true)
    expect(
      validateBookstackBooks(Array.from({ length: 17 }, (_, index) => `b${index}`).join(',')),
    ).not.toBe(true)
  })

  it('normalises books into a comma-separated list', () => {
    expect(splitBookstackBooks(' v-rising , scripts ')).toEqual(['v-rising', 'scripts'])
    expect(splitBookstackBooks(undefined)).toEqual([])
  })

  it('requires https URLs', () => {
    expect(validateBookstackUrl('https://bookstack.example.com')).toBe(true)
    expect(validateBookstackUrl('')).toBe(true)

    expect(validateBookstackUrl('http://bookstack.example.com')).not.toBe(true)
    expect(validateBookstackUrl('bookstack.example.com')).not.toBe(true)
    expect(validateBookstackUrl('https://user:pass@bookstack.example.com')).not.toBe(true)
  })

  it('accepts hostnames without a scheme or path', () => {
    expect(validateHostScope(['example.com', 'host1.example.com'])).toBe(true)
    expect(validateHostScope([])).toBe(true)
    expect(validateHostScope(null)).toBe(true)

    expect(validateHostScope(['https://example.com'])).not.toBe(true)
    expect(validateHostScope(['example.com/path'])).not.toBe(true)
    expect(validateHostScope(['host 1.example.com'])).not.toBe(true)
    expect(validateHostScope([''])).not.toBe(true)
  })

  it('enforces the runbook cross-field rules', () => {
    const complete = {
      url: 'https://bookstack.example.com',
      books: 'runbooks',
      token: 'operator',
    }

    expect(validateRunbookAccess(true, complete)).toBe(true)
    expect(validateRunbookAccess(false, {})).toBe(true)
    expect(validateRunbookAccess(false, undefined)).toBe(true)

    expect(validateRunbookAccess(true, {})).not.toBe(true)
    expect(validateRunbookAccess(true, { ...complete, url: '' })).not.toBe(true)
    expect(validateRunbookAccess(true, { ...complete, books: '' })).not.toBe(true)
    expect(validateRunbookAccess(true, { ...complete, token: '' })).not.toBe(true)
    expect(validateRunbookAccess(false, complete)).not.toBe(true)
  })

  it('finds duplicate target names case-insensitively', () => {
    expect(duplicateTargetNames([{ name: 'admin-chat' }, { name: 'automations' }])).toEqual([])
    expect(
      duplicateTargetNames([{ name: 'admin-chat' }, { name: 'Admin-Chat' }]),
    ).toEqual(['admin-chat'])
  })

  it('shapes the stored global like the agent parses it', () => {
    const shaped = toBotSettingsResponse({
      updatedAt: '2026-11-01T00:00:00.000Z',
      targets: [
        {
          id: 'row-1',
          name: 'admin-chat',
          channel_id: '000000000000000000',
          connected_account_id: 'ca_exampleconnection',
          host_scope: ['host1.example.com'],
          allow_content: false,
          allow_runbooks: true,
          bookstack: {
            url: 'https://bookstack.example.com',
            books: 'v-rising,scripts',
            token: 'vortex',
          },
        },
      ],
    })

    expect(shaped).toEqual({
      version: '2026-11-01T00:00:00.000Z',
      targets: {
        'admin-chat': {
          channel_id: '000000000000000000',
          connected_account_id: 'ca_exampleconnection',
          host_scope: ['host1.example.com'],
          allow_content: false,
          allow_runbooks: true,
          bookstack: {
            url: 'https://bookstack.example.com',
            books: 'v-rising,scripts',
            token: 'vortex',
          },
        },
      },
    })
  })

  it('returns null when the global has never been saved', () => {
    expect(toBotSettingsResponse({})).toBeNull()
    expect(toBotSettingsResponse(null)).toBeNull()
  })
})
