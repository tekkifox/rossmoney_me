import { describe, expect, it } from 'vitest'

import { buildStructuredData } from '@/components/StructuredData'
import { buildPagesSitemap } from '@/app/(frontend)/(sitemaps)/pages-sitemap.xml/route'
import type { Media } from '@/payload-types'
import { generateMeta } from '@/utilities/generateMeta'
import {
  buildOgImageUrl,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  ogImageAlt,
} from '@/utilities/ogImage'
import {
  DEFAULT_SITE_URL,
  getRobotsTag,
  getSiteHost,
  getSiteURL,
  isCanonicalHost,
  requestHostname,
} from '@/utilities/siteURL'

const SITE_NAME = 'Ross Money - Developer & DevOps Portfolio'

const generatedCard = (siteURL: string, title: string, description: string) => ({
  url: buildOgImageUrl(siteURL, { title, description }),
  alt: ogImageAlt(title),
  width: OG_IMAGE_WIDTH,
  height: OG_IMAGE_HEIGHT,
  type: 'image/png',
})

describe('site origin', () => {
  it('prefers SERVER_URL, then NEXT_PUBLIC_SERVER_URL', () => {
    expect(
      getSiteURL({
        SERVER_URL: 'https://www.example.com/',
        NEXT_PUBLIC_SERVER_URL: 'https://public.example.com',
      }),
    ).toBe('https://www.example.com')

    expect(getSiteURL({ NEXT_PUBLIC_SERVER_URL: 'https://public.example.com' })).toBe(
      'https://public.example.com',
    )
  })

  it('ignores Vercel deployment hostnames', () => {
    expect(
      getSiteURL({
        VERCEL: '1',
        VERCEL_PROJECT_PRODUCTION_URL: 'my-site.vercel.app',
        VERCEL_URL: 'my-site-abc123.vercel.app',
      }),
    ).toBe(DEFAULT_SITE_URL)
  })

  it('normalises a bare host to HTTPS', () => {
    expect(getSiteURL({ SERVER_URL: 'www.example.com' })).toBe('https://www.example.com')
  })

  it('falls back to the public production origin', () => {
    expect(getSiteURL({})).toBe(DEFAULT_SITE_URL)
    expect(getSiteHost({})).toBe('www.rossmoney.me')
  })

  it('reduces forwarded hosts to a hostname', () => {
    expect(requestHostname('www.example.com:443')).toBe('www.example.com')
    expect(requestHostname(' alias.example.com , proxy.internal')).toBe('alias.example.com')
    expect(requestHostname('')).toBeNull()
  })
})

describe('non-canonical host noindex', () => {
  it('keeps the canonical host indexable', () => {
    expect(isCanonicalHost('www.rossmoney.me', {})).toBe(true)
    expect(getRobotsTag('www.rossmoney.me:443', {})).toBeNull()
    expect(getRobotsTag(null, {})).toBeNull()
  })

  it('marks aliases, previews and dev mirrors noindex', () => {
    expect(getRobotsTag('rossmoney-me.vercel.app', {})).toBe('noindex, nofollow')
    expect(getRobotsTag('dev.rossmoney.me', {})).toBe('noindex, nofollow')
    expect(getRobotsTag('localhost:3000', {})).toBe('noindex, nofollow')
  })

  it('follows an explicitly configured public origin', () => {
    const env = { NEXT_PUBLIC_SERVER_URL: 'https://preview.example.com' }
    expect(getRobotsTag('preview.example.com', env)).toBeNull()
    expect(getRobotsTag('www.rossmoney.me', env)).toBe('noindex, nofollow')
  })
})

describe('generateMeta', () => {
  const siteURL = getSiteURL()

  it('writes the page canonical and og:url from the page slug', async () => {
    const meta = await generateMeta({
      doc: {
        slug: 'contact',
        title: 'Open to platform, DevOps, and development work.',
        lead: 'Lead text',
        meta: {
          title: 'Contact',
          description: 'Get in touch about platform and DevOps work.',
        },
      },
    })

    expect(meta.title).toBe(`Contact | ${SITE_NAME}`)
    expect(meta.description).toBe('Get in touch about platform and DevOps work.')
    expect(meta.alternates?.canonical).toBe(`${siteURL}/contact`)
    expect(meta.openGraph?.url).toBe(`${siteURL}/contact`)
    expect(meta.openGraph?.images).toEqual([
      generatedCard(
        siteURL,
        'Contact',
        'Get in touch about platform and DevOps work.',
      ),
    ])
  })

  it('falls back to the page title and lead when the metadata tab is empty', async () => {
    const meta = await generateMeta({
      doc: { slug: 'about', title: 'About me', lead: 'A short introduction.' },
    })

    expect(meta.title).toBe(`About me | ${SITE_NAME}`)
    expect(meta.description).toBe('A short introduction.')
    expect(meta.openGraph?.images).toEqual([
      generatedCard(siteURL, 'About me', 'A short introduction.'),
    ])
  })

  it('keeps an uploaded Open Graph image ahead of the generated card', async () => {
    const meta = await generateMeta({
      doc: {
        slug: 'about',
        title: 'About me',
        lead: 'A short introduction.',
        meta: {
          image: { url: '/media/about-og.jpg' } as unknown as Media,
        },
      },
    })

    expect(meta.openGraph?.images).toEqual([
      { url: `${siteURL}/media/about-og.jpg`, alt: expect.any(String) },
    ])
  })

  it('uses the static card when a page has no description', async () => {
    const meta = await generateMeta({
      doc: { slug: 'about', title: 'About me' },
    })

    expect(meta.openGraph?.images).toEqual([
      { url: `${siteURL}/og.jpg`, alt: expect.any(String) },
    ])
  })

  it('serves the home document at the site root', async () => {
    const meta = await generateMeta({ doc: { slug: 'home', title: 'Home' } })

    expect(meta.alternates?.canonical).toBe(siteURL)
    expect(meta.openGraph?.url).toBe(siteURL)
  })

  it('does not advertise the template twitter creator', async () => {
    const meta = await generateMeta({ doc: { slug: 'contact', title: 'Contact' } })
    const twitter = meta.twitter as Record<string, unknown>

    expect(twitter.card).toBe('summary_large_image')
    expect(twitter).not.toHaveProperty('creator')
    expect(twitter.images).toEqual([
      { url: `${siteURL}/og.jpg`, alt: expect.any(String) },
    ])
  })
})

describe('structured data', () => {
  it('describes the person and the website on the public origin', () => {
    const data = buildStructuredData('https://www.example.com')
    const graph = data['@graph'] as Array<Record<string, unknown>>

    const person = graph.find((node) => node['@type'] === 'Person')
    const website = graph.find((node) => node['@type'] === 'WebSite')

    expect(person).toMatchObject({
      name: 'Ross Money',
      url: 'https://www.example.com/',
      jobTitle: expect.any(String),
      sameAs: expect.arrayContaining(['https://github.com/tekkifox']),
    })
    expect(website).toMatchObject({
      name: SITE_NAME,
      url: 'https://www.example.com/',
      inLanguage: 'en',
    })
  })
})

describe('sitemap entries', () => {
  it('lists the root plus real pages with absolute URLs', () => {
    const entries = buildPagesSitemap(
      ['/', '/contact', '/work'],
      'https://www.example.com',
      '2026-01-01T00:00:00.000Z',
    )

    expect(entries.map((entry) => entry.loc)).toEqual([
      'https://www.example.com/',
      'https://www.example.com/contact',
    ])
  })
})
