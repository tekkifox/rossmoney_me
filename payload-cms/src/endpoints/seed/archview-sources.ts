import type { Payload } from 'payload'

type SeedEnv = {
  [key: string]: string | undefined
}

const read = (value: string | undefined): string =>
  typeof value === 'string' ? value.trim() : ''

const originOf = (value: string | undefined): string | null => {
  const candidate = read(value)
  if (!candidate) {
    return null
  }

  try {
    return new URL(candidate).origin
  } catch {
    return null
  }
}

export type SeededArchviewSources = {
  productionId?: string
  vortexserversId?: string
}

/**
 * Seeds the ArchView sources that a fresh deployment already knows how to
 * reach.
 *
 * The Production row is built from the existing environment at seed time; the
 * client secret is never written into source and is encrypted by the
 * collection's own `beforeChange` hook. The Vortexservers row is intentionally
 * anonymous (no client ID or secret) until an editor adds credentials.
 *
 * Rows are matched by origin, so running the seed again does not duplicate
 * them and does not overwrite edits made in the admin.
 */
export const seedArchviewSources = async (
  payload: Payload,
  env: SeedEnv = process.env,
): Promise<SeededArchviewSources> => {
  const tokenUrl = read(env.ARCHVIEW_TOKEN_URL)
  if (!tokenUrl) {
    // A local seed without Auth0 should keep working.
    return {}
  }

  const existing = await payload.find({
    collection: 'archview-sources',
    depth: 0,
    limit: 1000,
    overrideAccess: true,
    pagination: false,
  })

  const knownOrigins = new Map<string, string>()
  for (const row of existing.docs) {
    const origin = originOf(row.origin)
    if (origin) {
      knownOrigins.set(origin, row.id)
    }
  }

  const createIfMissing = async (data: {
    audience: string
    clientId?: string
    clientSecret?: string
    isDefault: boolean
    name: string
    origin: string
    project: string
    scope: string
    tokenUrl: string
  }): Promise<string | undefined> => {
    const origin = originOf(data.origin)
    if (!origin) {
      return undefined
    }

    const alreadySeeded = knownOrigins.get(origin)
    if (alreadySeeded !== undefined) {
      return alreadySeeded
    }

    try {
      const created = await payload.create({
        collection: 'archview-sources',
        data: { ...data, origin, enabled: true },
        depth: 0,
        overrideAccess: true,
      })
      knownOrigins.set(origin, created.id)
      payload.logger.info(`Seeded ArchView source: ${data.name}`)
      return created.id
    } catch (error) {
      // Do not include the client secret in the log line.
      payload.logger.warn(
        `Could not seed ArchView source "${data.name}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return undefined
    }
  }

  let productionId: string | undefined
  const productionOrigin = originOf(env.ARCHVIEW_URL)
  const productionClientId = read(env.ARCHVIEW_CLIENT_ID)
  const productionSecret = read(env.ARCHVIEW_CLIENT_SECRET)
  const productionKey = read(env.ARCHVIEW_SECRET_KEY)

  if (productionOrigin && productionClientId && productionSecret && productionKey) {
    productionId = await createIfMissing({
      name: 'Production',
      origin: productionOrigin,
      project: 'rossmoney_me',
      audience: read(env.ARCHVIEW_AUDIENCE) || `${productionOrigin}/api`,
      tokenUrl,
      clientId: productionClientId,
      clientSecret: productionSecret,
      scope: read(env.ARCHVIEW_SCOPE) || 'archview:read',
      isDefault: true,
    })
  } else if (productionOrigin && productionClientId && productionSecret && !productionKey) {
    payload.logger.warn(
      'Skipping the Production ArchView source seed: ARCHVIEW_SECRET_KEY is not set.',
    )
  }

  // Anonymous until an editor supplies credentials in the admin.
  const vortexserversId = await createIfMissing({
    name: 'Vortexservers',
    origin: 'https://archview.vortexservers.co.uk',
    project: 'vortexservers_co_uk',
    audience: 'https://archview.vortexservers.co.uk/api',
    tokenUrl,
    scope: 'archview:read',
    isDefault: false,
  })

  return { productionId, vortexserversId }
}
