import { getServerSideSitemap } from 'next-sitemap'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { buildPagesSitemap } from '@/app/(frontend)/(sitemaps)/pages-sitemap.xml/route'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The excluded slugs must never be advertised in the sitemap, even if an old
 * document still exists in the database. `/posts` and `/search` have no page
 * documents at all, so this spec creates them temporarily to prove the filter
 * is not merely relying on an empty collection.
 */
const EXCLUDED_SLUGS = ['posts', 'search', 'commits', 'experience', 'experience-page']

let payload: Payload
const createdIds: Array<string | number> = []

describe('pages sitemap', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    if (createdIds.length > 0) {
      await payload.delete({
        collection: 'pages',
        where: { id: { in: createdIds } },
        context: { disableRevalidate: true },
      })
    }
  })

  it('omits retired and renamed pages from the generated XML', async () => {
    for (const slug of EXCLUDED_SLUGS) {
      const existing = await payload.find({
        collection: 'pages',
        where: { slug: { equals: slug } },
        limit: 1,
        pagination: false,
      })

      if (existing.docs.length === 0) {
        const doc = await payload.create({
          collection: 'pages',
          draft: false,
          data: {
            slug,
            title: `Retired page ${slug}`,
            hero: { type: 'none' },
            _status: 'published',
          },
          context: { disableRevalidate: true },
        })
        createdIds.push(doc.id)
      }
    }

    // The renamed page is seeded by `onInit`; its old slug is not.
    const experience = await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'experience' } },
      limit: 1,
      pagination: false,
    })
    expect(experience.docs).toHaveLength(1)

    const pages = await payload.find({
      collection: 'pages',
      draft: false,
      limit: 1000,
      pagination: false,
      where: { _status: { equals: 'published' } },
      select: { slug: true, updatedAt: true },
    })

    const sitemap = buildPagesSitemap(pages.docs, 'https://example.com', new Date().toISOString())
    const xml = await (await getServerSideSitemap(sitemap)).text()

    for (const slug of EXCLUDED_SLUGS) {
      expect(xml).not.toContain(`/${slug}<`)
    }

    // Sanity check: a page that is still advertised is present.
    expect(xml).toContain('/contact<')
  })
})
