import { randomBytes } from 'node:crypto'

import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
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
  validateTailnet,
  validateTargetHostScope,
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
  all_hosts: false,
  host_scope: ['host1.example.com'],
  allow_content: false,
  allow_runbooks: true,
  bookstack: {
    url: 'https://bookstack.example.com',
    books: 'v-rising,scripts',
    token: 'vortex',
  },
})

/** An unrestricted target: the checkbox is ticked and no list is stored. */
const allHostsTarget = (): Target => {
  const target = baseTarget()
  target.all_hosts = true
  delete target.host_scope
  return target
}

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

const storedTargets = async (): Promise<Target[]> => {
  const stored = await payload.findGlobal({
    slug: 'bot-settings',
    depth: 0,
    overrideAccess: true,
  })
  return stored.targets ?? []
}

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
    expect(Object.keys(body).sort()).toEqual(['hosts', 'sources', 'targets', 'version'])
    expect(Object.keys(body.targets).sort()).toEqual(['admin-chat', 'automations'])
    expect(Array.isArray(body.sources)).toBe(true)
    expect(Number.isNaN(Date.parse(body.version))).toBe(false)

    for (const target of BOT_SETTINGS_SEED.targets) {
      const { name, all_hosts, host_scope, ...rest } = target
      const expected = all_hosts ? rest : { ...rest, host_scope }
      expect(body.targets[name]).toEqual(expected)
    }

    // An unrestricted target carries no host list at all; a restricted one
    // still carries exactly its list. `all_hosts` itself is panel state and is
    // not part of the agent's contract.
    expect(body.targets['admin-chat']).not.toHaveProperty('all_hosts')
    expect(body.targets['admin-chat']).toHaveProperty('host_scope', [
      'vortexservers.co.uk',
    ])
    expect(body.targets['automations']).not.toHaveProperty('host_scope')

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

describe('GET /api/bot-settings hosts', () => {
  let payload: Payload
  const prefix = `hosts-${randomBytes(4).toString('hex')}`
  const createdIds: string[] = []

  const createSource = async (
    suffix: string,
    overrides: Partial<RequiredDataFromCollectionSlug<'archview-sources'>> = {},
  ) => {
    const name = `${prefix}-${suffix}.example.test`
    const created = await payload.create({
      collection: 'archview-sources',
      data: {
        name,
        origin: `https://${name}`,
        audience: `https://${name}/api`,
        tokenUrl: 'https://identity.example.test/oauth/token',
        enabled: true,
        ...overrides,
      },
      overrideAccess: true,
    })
    createdIds.push(String(created.id))
    return created
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    if (createdIds.length > 0) {
      await payload.delete({
        collection: 'archview-sources',
        where: { id: { in: createdIds } },
        overrideAccess: true,
      })
    }
  })

  it('returns every enabled source with a port, sorted by name', async () => {
    await createSource('mike', { sshPort: 2200, tailnet: '203.0.113.10' })
    // No sshPort or tailnet: the stored default applies, and the entry carries
    // no tailnet key at all.
    await createSource('alpha')
    await createSource('zulu', { enabled: false, sshPort: 2201 })

    const response = await GET(request({ Authorization: `users API-Key ${BOT_API_KEY}` }))
    expect(response.status).toBe(200)
    const body = await response.json()

    const enabled = await payload.find({
      collection: 'archview-sources',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      where: { enabled: { equals: true } },
    })
    expect(body.hosts).toHaveLength(enabled.docs.length)

    const names = body.hosts.map((host: { name: string }) => host.name)
    expect(names).toEqual([...names].sort())

    expect(body.hosts).toContainEqual({ name: `${prefix}-alpha.example.test`, sshPort: 22 })
    expect(body.hosts).toContainEqual({
      name: `${prefix}-mike.example.test`,
      sshPort: 2200,
      tailnet: '203.0.113.10',
    })
    expect(names).not.toContain(`${prefix}-zulu.example.test`)

    const alpha = body.hosts.find(
      (host: { name: string }) => host.name === `${prefix}-alpha.example.test`,
    )
    expect(alpha).not.toHaveProperty('tailnet')

    for (const doc of enabled.docs) {
      expect(body.hosts).toContainEqual({
        name: doc.name,
        sshPort: doc.sshPort ?? 22,
        ...(doc.tailnet ? { tailnet: doc.tailnet } : {}),
      })
    }
  })

  it('rejects a port outside 1-65535, and a fractional port', async () => {
    await expect(createSource('port-zero', { sshPort: 0 })).rejects.toMatchObject({
      name: 'ValidationError',
    })
    await expect(createSource('port-high', { sshPort: 65536 })).rejects.toMatchObject({
      name: 'ValidationError',
    })
    await expect(createSource('port-fraction', { sshPort: 22.5 })).rejects.toMatchObject({
      name: 'ValidationError',
    })
  })

  it('rejects a tailnet value that is neither an IPv4 address nor a DNS name', async () => {
    const invalid = [
      ['tailnet-high', '203.0.113.256'],
      ['tailnet-short', '203.0.113'],
      ['tailnet-underscore', 'host_name.example.ts.net'],
      ['tailnet-trailing-dot', 'host.example.ts.net.'],
      ['tailnet-scheme', 'https://host.example.ts.net'],
      ['tailnet-port', 'host.example.ts.net:41641'],
    ] as const

    for (const [suffix, tailnet] of invalid) {
      await expect(createSource(suffix, { tailnet })).rejects.toMatchObject({
        name: 'ValidationError',
      })
    }
  })

  it('passes a stored tailnet DNS name through unchanged', async () => {
    await createSource('tailnet-name', { tailnet: 'host.example.ts.net' })

    const response = await GET(request({ Authorization: `users API-Key ${BOT_API_KEY}` }))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.hosts).toContainEqual({
      name: `${prefix}-tailnet-name.example.test`,
      sshPort: 22,
      tailnet: 'host.example.ts.net',
    })
  })

  it('leaves targets and sources byte-identical when hosts are added', async () => {
    const response = await GET(request({ Authorization: `users API-Key ${BOT_API_KEY}` }))
    const body = await response.json()

    const doc = await payload.findGlobal({
      slug: 'bot-settings',
      depth: 0,
      overrideAccess: true,
    })
    const withoutHosts = toBotSettingsResponse(doc)
    expect(withoutHosts).not.toBeNull()

    expect(JSON.stringify(body.targets)).toBe(JSON.stringify(withoutHosts?.targets))
    expect(JSON.stringify(body.sources)).toBe(JSON.stringify(withoutHosts?.sources))
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

  it('saves a target that reports on all hosts with no host list', async () => {
    await expect(saveTargets([allHostsTarget()])).resolves.toBeTruthy()

    const [stored] = await storedTargets()
    expect(stored?.all_hosts).toBe(true)
    expect(stored).not.toHaveProperty('host_scope')

    const response = await GET(request({ Authorization: `users API-Key ${BOT_API_KEY}` }))
    const body = await response.json()

    // Absence is the shape the agent treats as "every host". `[]` would be
    // refused at load time, so the key must not appear at all.
    expect(body.targets['admin-chat']).not.toHaveProperty('host_scope')
    expect(JSON.stringify(body.targets['admin-chat'])).not.toContain('host_scope')
  })

  it('drops a stale host list when report on all hosts is ticked', async () => {
    await expect(
      saveTargets([{ ...baseTarget(), all_hosts: true, host_scope: ['stale.example.com'] }]),
    ).resolves.toBeTruthy()

    // The beforeValidate hook removes the list, so Payload cannot store `[]`.
    const [stored] = await storedTargets()
    expect(stored?.all_hosts).toBe(true)
    expect(stored).not.toHaveProperty('host_scope')

    const response = await GET(request({ Authorization: `users API-Key ${BOT_API_KEY}` }))
    const body = await response.json()
    expect(body.targets['admin-chat']).not.toHaveProperty('host_scope')
  })

  it('rejects a restricted target with no host list', async () => {
    const target = baseTarget()
    target.all_hosts = false
    delete target.host_scope

    await expect(saveTargets([target])).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('rejects a restricted target with an empty host list', async () => {
    await expect(
      saveTargets([{ ...baseTarget(), all_hosts: false, host_scope: [] }]),
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('returns a restricted target host list exactly as stored', async () => {
    const hosts = ['host1.example.com', 'host2.example.com']
    await expect(
      saveTargets([{ ...baseTarget(), all_hosts: false, host_scope: hosts }]),
    ).resolves.toBeTruthy()

    const response = await GET(request({ Authorization: `users API-Key ${BOT_API_KEY}` }))
    const body = await response.json()

    expect(body.targets['admin-chat'].host_scope).toEqual(hosts)
  })

  it('requires a list when a previously unrestricted target is unticked', async () => {
    await expect(saveTargets([allHostsTarget()])).resolves.toBeTruthy()

    const unticked = baseTarget()
    unticked.all_hosts = false
    delete unticked.host_scope

    await expect(saveTargets([unticked])).rejects.toMatchObject({ name: 'ValidationError' })

    await expect(
      saveTargets([{ ...baseTarget(), all_hosts: false, host_scope: ['host1.example.com'] }]),
    ).resolves.toBeTruthy()
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

  it('requires at least one hostname for a restricted target', () => {
    expect(validateHostScope(['example.com', 'host1.example.com'])).toBe(true)

    expect(validateHostScope(['https://example.com'])).not.toBe(true)
    expect(validateHostScope(['example.com/path'])).not.toBe(true)
    expect(validateHostScope(['host 1.example.com'])).not.toBe(true)
    expect(validateHostScope([''])).not.toBe(true)

    // An empty or missing list is a load-time failure for the agent.
    expect(validateHostScope([])).not.toBe(true)
    expect(validateHostScope(undefined)).not.toBe(true)
    expect(validateHostScope(null)).not.toBe(true)
  })

  it('accepts IPv4 tailnet addresses and tailnet DNS names', () => {
    // IPv4, exactly as before.
    expect(validateTailnet('203.0.113.10')).toBe(true)
    expect(validateTailnet('0.0.0.0')).toBe(true)
    expect(validateTailnet('255.255.255.255')).toBe(true)
    expect(validateTailnet('')).toBe(true)
    expect(validateTailnet(null)).toBe(true)
    expect(validateTailnet(undefined)).toBe(true)

    // A tailnet DNS name: one or more labels, hyphens inside them, mixed case.
    expect(validateTailnet('host.example.ts.net')).toBe(true)
    expect(validateTailnet('my-host.example.ts.net')).toBe(true)
    expect(validateTailnet('node-1.example.ts.net')).toBe(true)
    expect(validateTailnet('Host.Example.TS.net')).toBe(true)
    expect(validateTailnet('host')).toBe(true)
    expect(validateTailnet('a-b.c')).toBe(true)

    // Label and total-length boundaries: 63 and 253 are allowed, one more is not.
    const label63 = 'a'.repeat(63)
    const name253 = [label63, label63, label63, 'a'.repeat(61)].join('.')
    const name254 = [label63, label63, label63, 'a'.repeat(62)].join('.')
    expect(name253).toHaveLength(253)
    expect(validateTailnet(name253)).toBe(true)
    expect(name254).toHaveLength(254)
    expect(validateTailnet(name254)).not.toBe(true)
    expect(validateTailnet(`${label63}b.example.ts.net`)).not.toBe(true)

    // A mistyped address stays a mistyped address, not a name.
    expect(validateTailnet('203.0.113.256')).not.toBe(true)
    expect(validateTailnet('203.0.113')).not.toBe(true)
    expect(validateTailnet('203.0.113.10.1')).not.toBe(true)
    expect(validateTailnet('203.0.113.010')).not.toBe(true)

    // Malformed name shapes: scheme, port, underscore, trailing dot,
    // whitespace, empty label, hyphen at either end.
    expect(validateTailnet('https://host.example.ts.net')).not.toBe(true)
    expect(validateTailnet('host.example.ts.net:41641')).not.toBe(true)
    expect(validateTailnet('host_name.example.ts.net')).not.toBe(true)
    expect(validateTailnet('host.example.ts.net.')).not.toBe(true)
    expect(validateTailnet(' host.example.ts.net')).not.toBe(true)
    expect(validateTailnet(' 203.0.113.10 ')).not.toBe(true)
    expect(validateTailnet('host..example.ts.net')).not.toBe(true)
    expect(validateTailnet('-host.example.ts.net')).not.toBe(true)
    expect(validateTailnet('host-.example.ts.net')).not.toBe(true)
    expect(validateTailnet(41641)).not.toBe(true)

    // The refusal names both accepted forms.
    const message = validateTailnet('not a valid value')
    expect(message).not.toBe(true)
    expect(String(message)).toContain('203.0.113.10')
    expect(String(message)).toContain('host.example.ts.net')
  })

  it('skips the host list when the target reports on all hosts', () => {
    expect(validateTargetHostScope(undefined, true)).toBe(true)
    expect(validateTargetHostScope(null, true)).toBe(true)
    expect(validateTargetHostScope([], true)).toBe(true)
    expect(validateTargetHostScope(['example.com'], true)).toBe(true)

    expect(validateTargetHostScope(undefined, false)).not.toBe(true)
    expect(validateTargetHostScope([], false)).not.toBe(true)
    expect(validateTargetHostScope(['example.com'], false)).toBe(true)
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
      hosts: [],
    })
  })

  it('shapes hosts sorted by name, defaulting the port and skipping a nameless source', () => {
    const shaped = toBotSettingsResponse(
      { updatedAt: '2026-11-01T00:00:00.000Z' },
      [
        { name: 'zulu.example.test', sshPort: 2200 },
        { name: '   ' },
        { name: 'alpha.example.test' },
        { name: 'mike.example.test', sshPort: 0 },
        { name: 'delta.example.test', tailnet: '203.0.113.10' },
        // A tailnet DNS name is passed through exactly as stored.
        { name: 'echo.example.test', tailnet: 'host.example.ts.net' },
        // Defensive: the field rejects this, but a stored value that slips
        // through must not reach the agent as an address.
        { name: 'bravo.example.test', tailnet: '203.0.113.256' },
      ],
    )

    expect(shaped?.hosts).toEqual([
      { name: 'alpha.example.test', sshPort: 22 },
      { name: 'bravo.example.test', sshPort: 22 },
      { name: 'delta.example.test', sshPort: 22, tailnet: '203.0.113.10' },
      { name: 'echo.example.test', sshPort: 22, tailnet: 'host.example.ts.net' },
      { name: 'mike.example.test', sshPort: 22 },
      { name: 'zulu.example.test', sshPort: 2200 },
    ])
  })

  it('omits host_scope for a target that reports on all hosts', () => {
    const shaped = toBotSettingsResponse({
      updatedAt: '2026-11-01T00:00:00.000Z',
      targets: [
        {
          name: 'every-host',
          channel_id: '000000000000000000',
          connected_account_id: 'ca_exampleconnection',
          all_hosts: true,
          // Defensive: even a stale list must not leak for an unrestricted target.
          host_scope: ['stale.example.com'],
          allow_content: false,
          allow_runbooks: false,
          bookstack: {},
        },
        {
          name: 'scoped',
          channel_id: '000000000000000001',
          connected_account_id: 'ca_exampleconnection',
          all_hosts: false,
          host_scope: ['host1.example.com'],
          allow_content: false,
          allow_runbooks: false,
          bookstack: {},
        },
      ],
      sources: [],
    })

    expect(shaped?.targets['every-host']).not.toHaveProperty('host_scope')
    expect(shaped?.targets.scoped.host_scope).toEqual(['host1.example.com'])
  })

  it('returns null when the global has never been saved', () => {
    expect(toBotSettingsResponse({})).toBeNull()
    expect(toBotSettingsResponse(null)).toBeNull()
  })
})
