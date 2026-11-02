import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { resolvePageTemplate } from '@/utilities/pageTemplates'

import { beforeAll, describe, expect, it } from 'vitest'

const SEEDED_TEMPLATES: Record<string, string> = {
  home: 'home',
  contact: 'contact',
  services: 'services',
  travelling: 'travelling',
  'game-servers': 'game-servers',
  cv: 'cv',
}

let payload: Payload

describe('page templates', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  it('prefers the page template over its slug', () => {
    expect(resolvePageTemplate({ slug: 'home', template: 'contact' })).toBe('contact')
  })

  it('falls back to the old slug chain when the template is unset', () => {
    expect(resolvePageTemplate({ slug: 'game-servers' })).toBe('game-servers')
    expect(resolvePageTemplate({ slug: 'gameservers' })).toBe('game-servers')
    expect(resolvePageTemplate({ slug: 'cv', template: null })).toBe('cv')
  })

  it('renders a page generically instead of nothing', () => {
    expect(resolvePageTemplate({ slug: 'a-new-page' })).toBe('default')
    expect(resolvePageTemplate({ slug: 'home', template: 'removed-template' })).toBe('default')
  })

  it('stores a template on every seeded page', async () => {
    const pages = await payload.find({
      collection: 'pages',
      draft: true,
      limit: 1000,
      pagination: false,
    })

    for (const [slug, template] of Object.entries(SEEDED_TEMPLATES)) {
      const page = pages.docs.find((candidate) => candidate.slug === slug)
      expect(page, `expected a seeded ${slug} page`).toBeDefined()
      expect(page?.template).toBe(template)
    }
  })
})
