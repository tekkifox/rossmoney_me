import type { Metadata } from 'next'

import type { Media, Page, Config } from '../payload-types'

import { mergeOpenGraph } from './mergeOpenGraph'
import { getSiteURL } from './siteURL'

const SITE_NAME = 'Ross Money - Developer & DevOps Portfolio'
const OG_IMAGE_ALT = 'Ross Money — DevOps-focused developer portfolio'

const getImageURL = (image?: Media | Config['db']['defaultIDType'] | null) => {
  const siteUrl = getSiteURL()

  let url = siteUrl + '/og.png'

  if (image && typeof image === 'object' && 'url' in image) {
    const ogUrl = image.sizes?.og?.url

    url = ogUrl ? siteUrl + ogUrl : siteUrl + image.url
  }

  return url
}

/**
 * Public path for a page document.
 *
 * `slug` is a plain string in the CMS; the array branch only guards against a
 * shaped value and is not what made every `og:url` resolve to `/` before (that
 * was an `Array.isArray` check that was always false). The home document stores
 * the slug `home` but is served at `/`.
 */
const pagePath = (slug?: string | string[] | null): string => {
  const parts = Array.isArray(slug) ? slug : typeof slug === 'string' ? [slug] : []
  const cleaned = parts
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '' && part !== 'home')

  return cleaned.length > 0 ? `/${cleaned.join('/')}` : '/'
}

export const generateMeta = async (args: {
  doc: Partial<Page> | null
}): Promise<Metadata> => {
  const { doc } = args

  const ogImage = getImageURL(doc?.meta?.image)

  // The CMS metadata tab wins; a page without it falls back to its own title
  // and lead so it still gets a descriptive title and description instead of
  // the bare site name.
  const pageTitle = doc?.meta?.title?.trim() || doc?.title?.trim()
  const title = pageTitle ? `${pageTitle} | ${SITE_NAME}` : SITE_NAME
  const lead = doc && 'lead' in doc ? doc.lead?.trim() : undefined
  const description = doc?.meta?.description?.trim() || lead || undefined
  const path = pagePath(doc?.slug)
  const siteURL = getSiteURL()
  const canonical = path === '/' ? siteURL : `${siteURL}${path}`
  const images = ogImage ? [{ url: ogImage, alt: OG_IMAGE_ALT }] : undefined

  return {
    alternates: {
      canonical,
    },
    description,
    openGraph: mergeOpenGraph({
      description: description || '',
      images,
      title,
      url: canonical,
    }),
    // Replacing the object (rather than merging it) also drops the template's
    // `creator: '@payloadcms'`. No site handle is known, so the honest card is
    // title/description/image with no attribution. Twitter/X inherits the
    // missing title and description from Open Graph.
    twitter: {
      card: 'summary_large_image',
      images,
    },
    title,
  }
}
