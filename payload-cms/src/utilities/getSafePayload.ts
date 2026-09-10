import configPromise from '@payload-config'
import { getPayload } from 'payload'

export async function getSafePayload() {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.SKIP_DB === 'true') {
    return {
      find: async () => ({ docs: [], totalDocs: 0 }),
      findGlobal: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
    } as any
  }

  try {
    return await getPayload({ config: configPromise })
  } catch {
    return {
      find: async () => ({ docs: [], totalDocs: 0 }),
      findGlobal: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
    } as any
  }
}
