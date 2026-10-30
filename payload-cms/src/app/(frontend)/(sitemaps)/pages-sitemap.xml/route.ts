import { getServerSideSitemap } from 'next-sitemap'
import { getPayload } from 'payload'
import config from '@payload-config'
import { unstable_cache } from 'next/cache'

// Slugs that must not be advertised in the sitemap. The experience page is
// excluded under both its current and legacy spellings. Keep this list in sync
// with `scripts/generate-sitemap.mjs`; both guards stop stale CMS documents from
// reappearing in a sitemap.
const SITEMAP_EXCLUDED_SLUGS = new Set([
  'posts',
  'search',
  'commits',
  'experience',
  'experience-page',
  'work',
  'architecture',
])

export interface SitemapPage {
  slug?: string | null
  updatedAt?: string | null
}

/** Build the sitemap entries, excluding the slugs above. */
export function buildPagesSitemap(
  docs: SitemapPage[],
  siteUrl: string,
  dateFallback: string,
): Array<{ loc: string; lastmod: string }> {
  return docs
    .filter((page): page is SitemapPage & { slug: string } => {
      return Boolean(page.slug) && !SITEMAP_EXCLUDED_SLUGS.has(page.slug as string)
    })
    .map((page) => {
      return {
        loc: page.slug === 'home' ? `${siteUrl}/` : `${siteUrl}/${page.slug}`,
        lastmod: page.updatedAt || dateFallback,
      }
    })
}

const getPagesSitemap = unstable_cache(
  async () => {
    const payload = await getPayload({ config })
    const SITE_URL =
      process.env.NEXT_PUBLIC_SERVER_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      'https://example.com'

    const results = await payload.find({
      collection: 'pages',
      overrideAccess: false,
      draft: false,
      depth: 0,
      limit: 1000,
      pagination: false,
      where: {
        _status: {
          equals: 'published',
        },
      },
      select: {
        slug: true,
        updatedAt: true,
      },
    })

    return buildPagesSitemap(results.docs, SITE_URL, new Date().toISOString())
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
