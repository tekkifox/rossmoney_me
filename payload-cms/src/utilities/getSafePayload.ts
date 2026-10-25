import configPromise from '@payload-config'
import { getPayload, type Payload } from 'payload'

/**
 * Inert Payload client used when there is no database to talk to (production
 * builds, or a database outage at request time). Every query resolves to an
 * empty result so pages degrade to their static fallbacks instead of throwing.
 */
function createEmptyPayloadClient(): Payload {
  const emptyResult = {
    docs: [],
    totalDocs: 0,
    limit: 0,
    totalPages: 0,
    page: 0,
    pagingCounter: 0,
    hasPrevPage: false,
    hasNextPage: false,
    prevPage: null,
    nextPage: null,
  }

  const client = {
    find: async () => emptyResult,
    findGlobal: async () => ({}),
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => ({}),
  }

  // `Payload` is the whole CMS surface (collections, auth, globals, jobs...).
  // A DB-less request only performs the five reads/writes stubbed above; the
  // rest is unreachable by design and deliberately left unimplemented.
  return client as unknown as Payload
}

export async function getSafePayload(): Promise<Payload> {
  if (process.env.SKIP_DB === 'true' || process.env.NEXT_PHASE === 'phase-production-build') {
    return createEmptyPayloadClient()
  }

  try {
    return await getPayload({ config: configPromise })
  } catch {
    return createEmptyPayloadClient()
  }
}
