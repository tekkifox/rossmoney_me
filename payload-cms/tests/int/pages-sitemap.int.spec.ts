import { getServerSideSitemap } from 'next-sitemap'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { buildPagesSitemap } from '@/app/(frontend)/(sitemaps)/pages-sitemap.xml/route'
import { architecture as architectureSeed } from '@/endpoints/seed/architecture-page'
import { commits as commitsSeed } from '@/endpoints/seed/commits-page'
import { experiencePage as experienceSeed } from '@/endpoints/seed/experience-page'
import { work as workSeed } from '@/endpoints/seed/work-page'
import { assembleSite } from '@/utilities/assembleSite'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The excluded slugs must never be advertised in the sitemap. The `commits`,
 * `experience-page`, `work` and `architecture` documents are still seeded;
 * `/posts`, `/search` and `/experience` have no page documents, so this spec
 * creates them temporarily to prove the filter is not merely relying on an
 * empty collection.
 */
const EXCLUDED_SLUGS = [
  'posts',
  'search',
  'commits',
  'experience',
  'experience-page',
  'work',
  'architecture',
]

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

  it('keeps the retired page data but seeds it as drafts', () => {
    expect(commitsSeed.slug).toBe('commits')
    expect(commitsSeed._status).toBe('draft')
    expect(experienceSeed.slug).toBe('experience-page')
    expect(experienceSeed._status).toBe('draft')
    expect(workSeed.slug).toBe('work')
    expect(workSeed._status).toBe('draft')
    expect(architectureSeed.slug).toBe('architecture')
    expect(architectureSeed._status).toBe('draft')
  })

  it('filters every excluded slug even when a published document exists', async () => {
    const docs = EXCLUDED_SLUGS.map((slug) => ({
      slug,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }))

    const sitemap = buildPagesSitemap(docs, 'https://example.com', '2026-01-01T00:00:00.000Z')
    expect(sitemap).toHaveLength(0)
  })

  it('keeps the retired page data available to the site payload', async () => {
    const site = await assembleSite(payload)

    expect(site.commits.title).toBe(commitsSeed.title)
    expect(site.experiencePage.title).toBe(experienceSeed.title)
    expect(site.work.title).toBe(workSeed.title)
    expect(site.architecture.title).toBe(architectureSeed.title)
    expect(site.experience).toBeDefined()
    expect(site.projects).toBeDefined()
  })

  it('omits the excluded slugs from the generated XML', async () => {
    for (const slug of EXCLUDED_SLUGS) {
      const existing = await payload.find({
        collection: 'pages',
        where: { slug: { equals: slug } },
        draft: true,
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
