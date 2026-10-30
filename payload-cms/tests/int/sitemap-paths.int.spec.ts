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

  it('expands fragment links to their full page variants', () => {
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

    expect(pathsFromHeader(header)).toEqual([
      '/work',
      '/architecture',
      '/commits',
      '/experience',
      '/cv',
      '/travelling',
    ])
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

  it('de-duplicates after expanding fragments', () => {
    const header: SitemapHeader = {
      navItems: [
        { link: { type: 'custom', url: '/#work' } },
        { link: { type: 'custom', url: '/work' } },
        { link: { type: 'custom', url: '/#work' } },
      ],
    }

    expect(pathsFromHeader(header)).toEqual(['/work'])
  })

  it('never emits an excluded path, including an expanded one', () => {
    const header: SitemapHeader = {
      navItems: [
        { link: { type: 'custom', url: '/posts' } },
        { link: { type: 'custom', url: '/search?q=payload' } },
        { link: { type: 'custom', url: '/experience-page/' } },
        { link: { type: 'custom', url: '/#experience-page' } },
        { link: { type: 'custom', url: '/work' } },
      ],
    }

    expect(pathsFromHeader(header)).toEqual(['/work'])
    expect(isSitemapExcluded('/experience-page/')).toBe(true)
    expect(isSitemapExcluded('/work')).toBe(false)
  })

  it('uses the seeded-header fallback when no database is available', async () => {
    await expect(resolveHeaderSitemapPaths()).resolves.toEqual([
      '/work',
      '/travelling',
      '/game-servers',
      '/experience',
      '/architecture',
      '/cv',
      '/contact',
    ])
  })
})
