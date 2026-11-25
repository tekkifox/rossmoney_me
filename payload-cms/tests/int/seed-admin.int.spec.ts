// @vitest-environment node
//
// The startup seed is the only thing that creates the dev admin, and it must
// keep running when Vercel Blob owns media uploads. These assertions call the
// real `onInit` a second time against the same throwaway database: seeding is
// idempotent, so the second run must not reset the user or skip the pages.
import type { Payload, SanitizedConfig } from 'payload'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seedAdminUser } from '@/endpoints/seed/admin-user'

const BLOB_TOKEN = 'vercel_blob_rw_seedtest_0123456789abcdef'
const ADMIN_EMAIL = 'startup-seed-admin@example.com'
const FIRST_PASSWORD = 'first-startup-password'
const SECOND_PASSWORD = 'second-startup-password'

const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN
const previousAdminEmail = process.env.PAYLOAD_SEED_ADMIN_EMAIL
const previousAdminPassword = process.env.PAYLOAD_SEED_ADMIN_PASSWORD

let payload: Payload
let payloadConfig: SanitizedConfig

const findAdmin = async () => {
  const users = await payload.find({
    collection: 'users',
    where: { email: { equals: ADMIN_EMAIL } },
    depth: 0,
    limit: 10,
    pagination: false,
    overrideAccess: true,
  })
  return users.docs
}

const findMapPage = async () => {
  const pages = await payload.find({
    collection: 'pages',
    depth: 0,
    limit: 1,
    pagination: false,
    where: { slug: { equals: 'map' } },
  })
  return pages.docs[0]
}

describe('startup seed', () => {
  beforeAll(async () => {
    const { default: config } = await import('@/payload.config')
    payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    await payload.delete({
      collection: 'users',
      where: { email: { equals: ADMIN_EMAIL } },
      overrideAccess: true,
    })
  }, 120_000)

  afterAll(async () => {
    await payload.delete({
      collection: 'users',
      where: { email: { equals: ADMIN_EMAIL } },
      overrideAccess: true,
    })
    await payload.destroy()

    restoreEnv('BLOB_READ_WRITE_TOKEN', previousBlobToken)
    restoreEnv('PAYLOAD_SEED_ADMIN_EMAIL', previousAdminEmail)
    restoreEnv('PAYLOAD_SEED_ADMIN_PASSWORD', previousAdminPassword)
  })

  it('still seeds the map page when BLOB_READ_WRITE_TOKEN is set', async () => {
    await payload.delete({
      collection: 'pages',
      where: { slug: { equals: 'map' } },
      overrideAccess: true,
    })
    expect(await findMapPage()).toBeUndefined()

    // The guard around the local `public/media` directory must not take the
    // rest of the startup seed with it.
    process.env.BLOB_READ_WRITE_TOKEN = BLOB_TOKEN
    await payloadConfig.onInit?.(payload)

    const map = await findMapPage()
    expect(map, 'the second startup should recreate /map even with blob storage').toBeDefined()
    expect(map.template).toBe('map')

    restoreEnv('BLOB_READ_WRITE_TOKEN', previousBlobToken)
  })

  it('creates the dev admin once and never resets it on later startups', async () => {
    process.env.PAYLOAD_SEED_ADMIN_EMAIL = ADMIN_EMAIL
    process.env.PAYLOAD_SEED_ADMIN_PASSWORD = FIRST_PASSWORD

    await payloadConfig.onInit?.(payload)

    const created = await findAdmin()
    expect(created).toHaveLength(1)
    const createdId = created[0].id

    // The user can sign in with the seeded password.
    const firstLogin = await payload.login({
      collection: 'users',
      data: { email: ADMIN_EMAIL, password: FIRST_PASSWORD },
    })
    expect(firstLogin.token).toBeTruthy()

    // Read the document after the session was issued, so signing in cannot
    // change what "untouched by the next startup" is compared against.
    const beforeSecondRun = await findAdmin()
    const updatedBeforeSecondRun = beforeSecondRun[0].updatedAt

    // A second startup with a different configured password must not touch the
    // existing document: same id, same updatedAt, and the original password.
    process.env.PAYLOAD_SEED_ADMIN_PASSWORD = SECOND_PASSWORD
    await payloadConfig.onInit?.(payload)

    const afterSecondRun = await findAdmin()
    expect(afterSecondRun).toHaveLength(1)
    expect(afterSecondRun[0].id).toBe(createdId)
    expect(afterSecondRun[0].updatedAt).toBe(updatedBeforeSecondRun)

    const originalStillWorks = await payload.login({
      collection: 'users',
      data: { email: ADMIN_EMAIL, password: FIRST_PASSWORD },
    })
    expect(originalStillWorks.token).toBeTruthy()

    await expect(
      payload.login({
        collection: 'users',
        data: { email: ADMIN_EMAIL, password: SECOND_PASSWORD },
      }),
    ).rejects.toBeTruthy()

    restoreEnv('PAYLOAD_SEED_ADMIN_EMAIL', previousAdminEmail)
    restoreEnv('PAYLOAD_SEED_ADMIN_PASSWORD', previousAdminPassword)
  })

  it('does nothing when the optional admin variables are unset', async () => {
    await payload.delete({
      collection: 'users',
      where: { email: { equals: ADMIN_EMAIL } },
      overrideAccess: true,
    })

    const outcome = await seedAdminUser(payload, {})

    expect(outcome).toBe('skipped')
    expect(await findAdmin()).toHaveLength(0)
  })
})

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
