import type { RequiredDataFromCollectionSlug } from 'payload'

export const navigation: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'navigation',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Navigation',
  title: 'Site navigation links.',
  lead: 'Structured links used by the CMS-driven header and footer.',
  data: {
    links: [
      { label: 'Work', href: '#work' },
      { label: 'Experience', href: '#experience' },
      { label: 'Architecture', href: '#architecture' },
      { label: 'Commits', href: '#commits' },
      { label: 'Contact', href: '#contact' },
    ],
  },
  layout: [],
}
