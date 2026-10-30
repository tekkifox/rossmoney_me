import { getServerSideSitemap } from 'next-sitemap'
import { unstable_cache } from 'next/cache'

import { getSafePayload } from '@/utilities/getSafePayload'
import { isSitemapExcluded, resolveHeaderSitemapPaths } from '@/utilities/sitemapPaths'

export interface SitemapEntry {
  loc: string
  lastmod: string
}

/**
 * Build XML entries from the paths the header advertises. The exclusions are
 * applied again here as a final guard so a path can never reach the XML even if
 * a future caller bypasses the resolver.
 */
export function buildPagesSitemap(
  paths: string[],
  siteUrl: string,
  dateFallback: string,
): SitemapEntry[] {
  return paths
    .filter((path) => path.startsWith('/') && !isSitemapExcluded(path))
    .map((path) => ({
      loc: `${siteUrl}${path}`,
      lastmod: dateFallback,
    }))
}

const getPagesSitemap = unstable_cache(
  async () => {
    const payload = await getSafePayload()
    const siteUrl =
      process.env.NEXT_PUBLIC_SERVER_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      'https://example.com'

    const paths = await resolveHeaderSitemapPaths(payload)
    return buildPagesSitemap(paths, siteUrl, new Date().toISOString())
  },
  ['pages-sitemap'],
  {
    tags: ['pages-sitemap'],
  },
)

export async function GET() {
  const sitemap = await getPagesSitemap()

  return getServerSideSitemap(sitemap)
}
