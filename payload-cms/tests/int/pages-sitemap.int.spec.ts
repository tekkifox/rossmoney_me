import { getServerSideSitemap } from 'next-sitemap'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { buildPagesSitemap } from '@/app/(frontend)/(sitemaps)/pages-sitemap.xml/route'
import type { Header } from '@/payload-types'
import { assembleSite } from '@/utilities/assembleSite'
import { resolveHeaderSitemapPaths, SITEMAP_EXCLUDED_PATHS } from '@/utilities/sitemapPaths'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SITE_URL = 'https://example.com'
const DATE_FALLBACK = '2026-01-01T00:00:00.000Z'
const EXCLUDED_PATHS: string[] = [...SITEMAP_EXCLUDED_PATHS]

let payload: Payload
let originalNavItems: Header['navItems']

describe('pages sitemap', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const header = await payload.findGlobal({ slug: 'header', depth: 0 })
    originalNavItems = header.navItems
  })

  afterAll(async () => {
    if (originalNavItems === undefined) return

    await payload.updateGlobal({
      slug: 'header',
      data: { navItems: originalNavItems },
      context: { disableRevalidate: true },
    })
  })

  it('keeps the homepage data available without the retired pages', async () => {
    const site = await assembleSite(payload)

    // The retired page documents are no longer seeded; the homepage reads the
    // experience and projects collections, and the assembled site still exposes
    // those sections, just without the retired page content.
    expect(site.experience).toBeDefined()
    expect(site.projects).toBeDefined()
  })

  it('filters only the excluded paths, even when they arrive from the header', async () => {
    const paths = [...EXCLUDED_PATHS, '/work', '/commits', '/experience', '/architecture']
    const sitemap = buildPagesSitemap(paths, SITE_URL, DATE_FALLBACK)
    const xml = await (await getServerSideSitemap(sitemap)).text()

    for (const path of EXCLUDED_PATHS) {
      expect(xml).not.toContain(`${path}<`)
    }

    for (const path of ['/work', '/commits', '/experience', '/architecture']) {
      expect(xml).toContain(`${path}<`)
    }
  })

  it('emits exactly the header paths minus the exclusions', async () => {
    const contact = await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'contact' }, _status: { equals: 'published' } },
      draft: false,
      limit: 1,
      pagination: false,
    })
    expect(contact.docs).toHaveLength(1)

    await payload.updateGlobal({
      slug: 'header',
      data: {
        navItems: [
          { link: { type: 'custom', label: 'Work', url: '/#work' } },
          { link: { type: 'custom', label: 'Travelling', url: '/travelling' } },
          {
            link: {
              type: 'reference',
              label: 'Contact',
              reference: { relationTo: 'pages', value: contact.docs[0]?.id },
            },
          },
          { link: { type: 'custom', label: 'Posts', url: '/posts' } },
          {
            link: {
              type: 'custom',
              label: 'Legacy experience alias',
              url: '/#experience-page',
            },
          },
          { link: { type: 'custom', label: 'Architecture', url: '/#architecture' } },
          { link: { type: 'custom', label: 'Commits', url: '/#commits' } },
          { link: { type: 'custom', label: 'Experience', url: '/#experience' } },
        ],
      },
      context: { disableRevalidate: true },
    })

    const paths = await resolveHeaderSitemapPaths(payload)
    expect(paths).toEqual([
      '/work',
      '/travelling',
      '/contact',
      '/architecture',
      '/commits',
      '/experience',
    ])

    const sitemap = buildPagesSitemap(paths, SITE_URL, DATE_FALLBACK)
    expect(sitemap.map((entry) => entry.loc)).toEqual(
      paths.map((path) => `${SITE_URL}${path}`),
    )

    const xml = await (await getServerSideSitemap(sitemap)).text()
    for (const path of paths) {
      expect(xml).toContain(`${path}<`)
    }
    for (const path of EXCLUDED_PATHS) {
      expect(xml).not.toContain(`${path}<`)
    }
  })
})
