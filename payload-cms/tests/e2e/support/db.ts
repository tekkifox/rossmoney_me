import { getPayload, type Payload } from 'payload'

import config from '../../../src/payload.config.js'

/**
 * Test-only database helpers for the browser smoke suite.
 *
 * The suite runs against a production server (`pnpm start`), so it cannot use
 * Payload's dev-only seed endpoint. Connecting from the Playwright worker uses
 * the same `MONGODB_URI` the server does, exactly like `tests/helpers/seedUser.ts`
 * does for the legacy admin spec.
 *
 * A dedicated account is used instead of the legacy `dev@payloadcms.com` one so
 * the two admin specs never delete each other's session in a parallel local run.
 */
export const smokeUser = {
  name: 'CSP Smoke',
  email: 'csp-smoke@rossmoney.test',
  password: 'csp-smoke-password',
}

const smokePageSlugPrefix = 'csp-smoke'

let cachedPayload: Payload | null = null

const payload = async (): Promise<Payload> => {
  if (!cachedPayload) {
    cachedPayload = await getPayload({ config })
  }

  return cachedPayload
}

export const seedSmokeUser = async (): Promise<void> => {
  const client = await payload()

  await client.delete({
    collection: 'users',
    where: { email: { equals: smokeUser.email } },
  })

  await client.create({
    collection: 'users',
    data: smokeUser,
  })
}

export const cleanupSmokeUser = async (): Promise<void> => {
  const client = await payload()

  await client.delete({
    collection: 'users',
    where: { email: { equals: smokeUser.email } },
  })
}

/** Removes any pages a previous (possibly failed) smoke run left behind. */
export const cleanupSmokePages = async (): Promise<void> => {
  const client = await payload()

  const existing = await client.find({
    collection: 'pages',
    where: { slug: { like: smokePageSlugPrefix } },
    draft: true,
    limit: 100,
    pagination: false,
  })

  for (const page of existing.docs) {
    await client.delete({
      collection: 'pages',
      id: page.id,
      // The test process is not inside a Next.js request, so the page's
      // afterDelete hook cannot call revalidatePath/revalidateTag.
      context: { disableRevalidate: true },
    })
  }
}
