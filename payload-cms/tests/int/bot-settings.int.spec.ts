import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as botSettingsRoute from '@/app/api/bot-settings/route'
import { GET } from '@/app/api/bot-settings/route'
import type { BotSetting } from '@/payload-types'
import config from '@/payload.config'
import { BOT_SETTINGS_SEED, seedBotSettings } from '@/endpoints/seed/bot-settings'
import {
  duplicateNames,
  splitBookstackBooks,
  toBotSettingsResponse,
  validateAllowedAuthors,
  validateBookstackBooks,
  validateBookstackUrl,
  validateChannelId,
  validateConnectedAccountId,
  validateCredentialName,
  validateHostScope,
  validateRunbookAccess,
  validateSourceChannelMatchesTarget,
  validateSourceTarget,
  validateTargetName,
} from '@/utilities/botSettings'

type Target = NonNullable<BotSetting['targets']>[number]
type Source = NonNullable<BotSetting['sources']>[number]

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

const baseSource = (): Source => ({
  name: 'example-source',
  connected_account_id: 'ca_exampleconnection',
  channel_id: '000000000000000000',
  allowed_authors: ['452902515734741002'],
  target: 'admin-chat',
})

const saveBotSettings = (data: {
  sources?: Source[]
  targets?: Target[]
}) =>
  payload.updateGlobal({
    slug: 'bot-settings',
    data,
    depth: 0,
    overrideAccess: true,
  })

const saveTargets = (targets: Target[]) => saveBotSettings({ targets })

// Source tests save the target they point at in the same write, so the channel
// match rule is exercised against a known target rather than whatever an
// earlier test left behind.
const saveSources = (sources: Source[]) =>
  saveBotSettings({ targets: [baseTarget()], sources })

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
    expect(Object.keys(body).sort()).toEqual(['sources', 'targets', 'version'])
    expect(Object.keys(body.targets).sort()).toEqual(['admin-chat', 'automations'])
    expect(Array.isArray(body.sources)).toBe(true)
    expect(Number.isNaN(Date.parse(body.version))).toBe(false)

    for (const target of BOT_SETTINGS_SEED.targets) {
      const { name, ...expected } = target
      expect(body.targets[name]).toEqual(expected)
    }

    // Sources stay an array; `allowed_authors` is the comma-joined string the
    // agent's NOTIFY_INBOUND_SOURCES entry used.
    expect(body.sources).toEqual(
      BOT_SETTINGS_SEED.sources.map((source) => ({
        ...source,
        allowed_authors: source.allowed_authors.join(','),
      })),
    )
    for (const source of body.sources) {
      expect(typeof source.allowed_authors).toBe('string')
    }

    // Only the resolved shape is exposed: no row ids, timestamps or credentials.
    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain('apiKey')
    expect(serialised).not.toContain('"id"')
    expect(serialised).not.toContain('createdAt')
  })

  it('renders allowed_authors as a comma-separated string', async () => {
    await saveSources([
      {
        ...baseSource(),
        name: 'with-authors',
        allowed_authors: ['111111111111111111', '222222222222222222'],
      },
    ])

    const response = await GET(request({ Authorization: `users API-Key ${BOT_API_KEY}` }))
    const body = await response.json()

    expect(body.sources.map((source: { name: string }) => source.name)).toEqual(['with-authors'])
    expect(body.sources[0].allowed_authors).toBe('111111111111111111,222222222222222222')
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
    await expect(
      saveBotSettings({
        targets: BOT_SETTINGS_SEED.targets as Target[],
        sources: BOT_SETTINGS_SEED.sources as Source[],
      }),
    ).resolves.toBeTruthy()
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

  it('accepts a source that names an existing target on the same channel', async () => {
    await expect(saveSources([baseSource()])).resolves.toBeTruthy()
  })

  it('rejects a source with no allowed authors', async () => {
    await expect(
      saveSources([{ ...baseSource(), allowed_authors: [] }]),
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects a target with no hosts', async () => {
    await expect(saveTargets([{ ...baseTarget(), host_scope: [] }])).rejects.toMatchObject({
      name: 'ValidationError',
    })
  })

  it('rejects a non-numeric target channel id', async () => {
    await expect(
      saveTargets([{ ...baseTarget(), channel_id: 'admin-chat' }]),
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects a non-numeric source channel id', async () => {
    await expect(
      saveSources([{ ...baseSource(), channel_id: 'general' }]),
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects a source whose channel differs from its target, naming both', async () => {
    const failure = await saveSources([
      { ...baseSource(), channel_id: '000000000000000009' },
    ]).then(
      () => null,
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({ name: 'ValidationError' })
    const messages = (
      (failure as { data?: { errors?: Array<{ message?: string }> } }).data?.errors ?? []
    )
      .map((error) => error.message)
      .join(' ')
    expect(messages).toContain('000000000000000009')
    expect(messages).toContain('000000000000000000')
  })

  it('rejects whitespace in a connected account id', async () => {
    await expect(
      saveTargets([{ ...baseTarget(), connected_account_id: 'ca_example connection' }]),
    ).rejects.toMatchObject({ name: 'ValidationError' })

    await expect(
      saveSources([{ ...baseSource(), connected_account_id: 'ca_example connection' }]),
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects a source that names a target which does not exist, and names it', async () => {
    const failure = await saveSources([{ ...baseSource(), target: 'no-such-target' }]).then(
      () => null,
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({ name: 'ValidationError' })
    const messages = (
      (failure as { data?: { errors?: Array<{ message?: string }> } }).data?.errors ?? []
    )
      .map((error) => error.message)
      .join(' ')
    expect(messages).toContain('no-such-target')
  })

  it('rejects duplicate source names', async () => {
    const second: Source = { ...baseSource(), channel_id: '000000000000000001' }

    await expect(saveSources([baseSource(), second])).rejects.toMatchObject({
      name: 'ValidationError',
    })
  })

  it('drops unknown fields instead of storing them', async () => {
    const smuggled = {
      ...baseSource(),
      bookstack_token: 'super-secret-value',
      apiKey: 'another-secret-value',
    } as unknown as Source

    await expect(saveSources([smuggled])).resolves.toBeTruthy()

    const response = await GET(request({ Authorization: `users API-Key ${BOT_API_KEY}` }))
    const body = await response.json()
    const serialised = JSON.stringify(body)

    expect(serialised).not.toContain('super-secret-value')
    expect(serialised).not.toContain('another-secret-value')
    expect(Object.keys(body.sources[0]).sort()).toEqual([
      'allowed_authors',
      'channel_id',
      'connected_account_id',
      'name',
      'target',
    ])

    const stored = await payload.findGlobal({
      slug: 'bot-settings',
      depth: 0,
      overrideAccess: true,
    })
    expect(JSON.stringify(stored.sources)).not.toContain('super-secret-value')
  })

  afterAll(async () => {
    await seedBotSettings(payload, true)
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

  it('requires at least one hostname without a scheme or path', () => {
    expect(validateHostScope(['example.com', 'host1.example.com'])).toBe(true)

    expect(validateHostScope(['https://example.com'])).not.toBe(true)
    expect(validateHostScope(['example.com/path'])).not.toBe(true)
    expect(validateHostScope(['host 1.example.com'])).not.toBe(true)
    expect(validateHostScope([''])).not.toBe(true)

    // An empty scope is a load-time failure for the agent, not "no narrowing".
    expect(validateHostScope([])).not.toBe(true)
    expect(validateHostScope(null)).not.toBe(true)
    expect(validateHostScope(undefined)).not.toBe(true)
  })

  it('requires Discord snowflakes for channel ids', () => {
    expect(validateChannelId('1314326014318481458')).toBe(true)
    expect(validateChannelId('0')).toBe(true)
    expect(validateChannelId('1'.repeat(32))).toBe(true)

    expect(validateChannelId('1'.repeat(33))).not.toBe(true)
    expect(validateChannelId('admin-chat')).not.toBe(true)
    expect(validateChannelId('123 456')).not.toBe(true)
    expect(validateChannelId('')).not.toBe(true)
    expect(validateChannelId(null)).not.toBe(true)
  })

  it('accepts any non-empty connected account id without whitespace', () => {
    expect(validateConnectedAccountId('ca_exampleconnection')).toBe(true)
    expect(validateConnectedAccountId('not-a-ca-id')).toBe(true)

    expect(validateConnectedAccountId('')).not.toBe(true)
    expect(validateConnectedAccountId(' ')).not.toBe(true)
    expect(validateConnectedAccountId('ca_example connection')).not.toBe(true)
    expect(validateConnectedAccountId(null)).not.toBe(true)
  })

  it('requires at least one allowed author', () => {
    expect(validateAllowedAuthors(['452902515734741002'])).toBe(true)
    expect(validateAllowedAuthors(['452902515734741002', '111111111111111111'])).toBe(true)

    expect(validateAllowedAuthors([])).not.toBe(true)
    expect(validateAllowedAuthors([''])).not.toBe(true)
    expect(validateAllowedAuthors(null)).not.toBe(true)
  })

  it('requires a source channel to match its target channel', () => {
    const targets = [{ name: 'admin-chat', channel_id: '1314326014318481458' }]

    expect(
      validateSourceChannelMatchesTarget('1314326014318481458', 'admin-chat', targets),
    ).toBe(true)
    expect(validateSourceChannelMatchesTarget('1', 'missing-target', targets)).toBe(true)

    const mismatch = validateSourceChannelMatchesTarget(
      '1549913741280157818',
      'admin-chat',
      targets,
    )
    expect(mismatch).not.toBe(true)
    expect(mismatch).toContain('1549913741280157818')
    expect(mismatch).toContain('1314326014318481458')
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

  it('finds duplicate names case-insensitively', () => {
    expect(duplicateNames([{ name: 'admin-chat' }, { name: 'automations' }])).toEqual([])
    expect(duplicateNames([{ name: 'admin-chat' }, { name: 'Admin-Chat' }])).toEqual([
      'admin-chat',
    ])
  })

  it('requires a source to name a target in the same document', () => {
    const targets = [{ name: 'admin-chat' }, { name: 'automations' }]

    expect(validateSourceTarget('admin-chat', targets)).toBe(true)
    expect(validateSourceTarget('automations', targets)).toBe(true)
    expect(validateSourceTarget('', targets)).toBe(true)
    expect(validateSourceTarget(null, targets)).toBe(true)

    // Case-sensitive on purpose: the agent keys `targets` by exact name.
    expect(validateSourceTarget('Admin-Chat', targets)).not.toBe(true)
    expect(validateSourceTarget('no-such-target', targets)).toContain('no-such-target')
    expect(validateSourceTarget('admin-chat', [])).not.toBe(true)
    expect(validateSourceTarget('admin-chat', undefined)).not.toBe(true)
  })

  it('accepts key-safe source names', () => {
    expect(validateTargetName('vortex-admin')).toBe(true)
    expect(validateTargetName('automations_general')).toBe(true)
    expect(validateTargetName('has space')).not.toBe(true)
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
      sources: [
        {
          id: 'row-2',
          name: 'vortex-admin',
          connected_account_id: 'ca_exampleconnection',
          channel_id: '000000000000000000',
          allowed_authors: ['111111111111111111', '222222222222222222'],
          target: 'admin-chat',
        },
        {
          // Legacy rows from before the allowlist became required still shape
          // into an empty string rather than breaking the agent's parser.
          id: 'row-3',
          name: 'legacy-empty',
          connected_account_id: 'ca_exampleconnection',
          channel_id: '000000000000000001',
          allowed_authors: [],
          target: 'admin-chat',
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
      sources: [
        {
          name: 'vortex-admin',
          connected_account_id: 'ca_exampleconnection',
          channel_id: '000000000000000000',
          allowed_authors: '111111111111111111,222222222222222222',
          target: 'admin-chat',
        },
        {
          name: 'legacy-empty',
          connected_account_id: 'ca_exampleconnection',
          channel_id: '000000000000000001',
          allowed_authors: '',
          target: 'admin-chat',
        },
      ],
    })
  })

  it('returns null when the global has never been saved', () => {
    expect(toBotSettingsResponse({})).toBeNull()
    expect(toBotSettingsResponse(null)).toBeNull()
  })
})
