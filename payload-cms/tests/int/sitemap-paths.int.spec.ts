import { describe, expect, it } from 'vitest'

import {
  isSitemapExcluded,
  pathsFromHeader,
  resolveHeaderSitemapPaths,
  type SitemapHeader,
} from '@/utilities/sitemapPaths'

const published = new Map([
  ['pages:about', 'about'],
  ['pages:contact', 'contact'],
])

describe('header sitemap resolver', () => {
  it('resolves a published reference to its slug', () => {
    const header: SitemapHeader = {
      navItems: [
        {
          link: {
            type: 'reference',
            reference: { relationTo: 'pages', value: 'about' },
          },
        },
        {
          link: {
            type: 'reference',
            reference: { relationTo: 'pages', value: { id: 'contact', slug: 'contact' } },
          },
        },
      ],
    }

    expect(pathsFromHeader(header, published)).toEqual(['/about', '/contact'])
  })

  it('skips missing and unpublished references', () => {
    const header: SitemapHeader = {
      navItems: [
        {
          link: {
            type: 'reference',
            reference: { relationTo: 'pages', value: 'missing' },
          },
        },
        {
          link: {
            type: 'reference',
            reference: {
              relationTo: 'pages',
              value: { id: 'draft', slug: 'draft', _status: 'draft' },
            },
          },
        },
      ],
    }

    expect(pathsFromHeader(header, published)).toEqual([])
  })

  it('keeps a custom site-relative path', () => {
    const header: SitemapHeader = {
      navItems: [{ link: { type: 'custom', url: '/travelling' } }],
    }

    expect(pathsFromHeader(header)).toEqual(['/travelling'])
  })

  it('reduces homepage fragments to the homepage', () => {
    const header: SitemapHeader = {
      navItems: [
        { link: { type: 'custom', url: '/#work' } },
        { link: { type: 'custom', url: '/#architecture' } },
        { link: { type: 'custom', url: '/#commits' } },
        { link: { type: 'custom', url: '/#experience' } },
        { link: { type: 'custom', url: '#cv' } },
        { link: { type: 'custom', url: '/travelling#notes' } },
      ],
    }

    expect(pathsFromHeader(header)).toEqual(['/', '/travelling'])
  })

  it('skips external URLs', () => {
    const header: SitemapHeader = {
      navItems: [
        { link: { type: 'custom', url: 'https://example.com/about' } },
        { link: { type: 'custom', url: 'http://example.com/about' } },
        { link: { type: 'custom', url: '//example.com/about' } },
        { link: { type: 'custom', url: 'mailto:hello@example.com' } },
        { link: { type: 'custom', url: '/contact' } },
      ],
    }

    expect(pathsFromHeader(header)).toEqual(['/contact'])
  })

  it('de-duplicates after reducing fragments', () => {
    const header: SitemapHeader = {
      navItems: [
        { link: { type: 'custom', url: '/#work' } },
        { link: { type: 'custom', url: '/' } },
        { link: { type: 'custom', url: '/#work' } },
      ],
    }

    expect(pathsFromHeader(header)).toEqual(['/'])
  })

  it('never emits an excluded path, including a retired page', () => {
    const header: SitemapHeader = {
      navItems: [
        { link: { type: 'custom', url: '/posts' } },
        { link: { type: 'custom', url: '/search?q=payload' } },
        { link: { type: 'custom', url: '/experience-page/' } },
        { link: { type: 'custom', url: '/#experience-page' } },
        { link: { type: 'custom', url: '/work' } },
        { link: { type: 'custom', url: '/architecture' } },
      ],
    }

    expect(pathsFromHeader(header)).toEqual(['/'])
    expect(isSitemapExcluded('/experience-page/')).toBe(true)
    expect(isSitemapExcluded('/work')).toBe(true)
    expect(isSitemapExcluded('/commits')).toBe(true)
    expect(isSitemapExcluded('/experience')).toBe(true)
    expect(isSitemapExcluded('/architecture')).toBe(true)
    expect(isSitemapExcluded('/contact')).toBe(false)
  })

  it('always starts the sitemap with the homepage', async () => {
    await expect(resolveHeaderSitemapPaths()).resolves.toEqual([
      '/',
      '/travelling',
      '/game-servers',
      '/map',
      '/cv',
      '/contact',
    ])
  })
})
