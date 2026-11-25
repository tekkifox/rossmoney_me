import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'

import { beforeAll, describe, expect, it } from 'vitest'

/**
 * A fresh database is seeded by `payload.config.ts` `onInit`. The retired page
 * documents (`commits`, `experience-page`, `work`, `architecture`) were drafted
 * and their templates removed, so they must not be created at all. Existing
 * databases still hold them; `scripts/unpublish-retired-pages.ts` drafts those.
 */
const SEEDED_PAGE_SLUGS = ['home', 'contact', 'services', 'travelling', 'game-servers', 'map', 'cv']
const RETIRED_PAGE_SLUGS = ['commits', 'experience-page', 'work', 'architecture']

let payload: Payload

describe('default page seeding', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  it('still creates every remaining default page', async () => {
    const pages = await payload.find({
      collection: 'pages',
      draft: true,
      limit: 1000,
      pagination: false,
      select: { slug: true },
    })
    const slugs = pages.docs.map((page) => page.slug)

    for (const slug of SEEDED_PAGE_SLUGS) {
      expect(slugs).toContain(slug)
    }
  })

  it('creates the map page with its template and public copy', async () => {
    const pages = await payload.find({
      collection: 'pages',
      draft: true,
      limit: 1,
      pagination: false,
      where: { slug: { equals: 'map' } },
    })

    const map = pages.docs[0]
    expect(map, 'the /map page should be seeded').toBeDefined()
    expect(map.template).toBe('map')
    expect(map.eyebrow).toBe('Architecture')
    expect(map.lead).toContain('one public edge')
    expect(map.focus?.items?.map((item) => item.value)).toEqual(['one', 'private', 'five'])
  })

  it('does not create the retired pages', async () => {
    const pages = await payload.find({
      collection: 'pages',
      draft: true,
      limit: 1000,
      pagination: false,
      where: {
        slug: {
          in: RETIRED_PAGE_SLUGS,
        },
      },
      select: { slug: true },
    })

    expect(pages.docs).toHaveLength(0)
  })
})
