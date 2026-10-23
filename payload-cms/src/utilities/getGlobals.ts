import type { Config } from 'src/payload-types'
import { type DataFromGlobalSlug } from 'payload'
import { getSafePayload } from './getSafePayload'
import { unstable_cache } from 'next/cache'

type Global = keyof Config['globals']

async function getGlobal<T extends Global>(slug: T, depth = 0): Promise<DataFromGlobalSlug<T>> {
  const payload = await getSafePayload()

  const global = await payload.findGlobal({
    slug,
    depth,
  })

  return global
}

/**
 * Returns a unstable_cache function mapped with the cache tag for the slug
 */
export const getCachedGlobal = <T extends Global>(slug: T, depth = 0) => {
  const cached = unstable_cache(
    async () => {
      const result = await getGlobal<T>(slug, depth)

      // Never cache empty/fallback global reads - they indicate an outage/stub
      if (!result || typeof result !== 'object' || Object.keys(result).length === 0) {
        throw new Error('EMPTY_GLOBAL')
      }

      return result
    },
    [slug],
    {
      tags: [`global_${slug}`],
      revalidate: 60,
    },
  )

  return async () => {
    try {
      return await cached()
    } catch {
      // Bypass cache on empty/stub reads
      return getGlobal<T>(slug, depth)
    }
  }
}
