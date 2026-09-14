import type { RequiredDataFromCollectionSlug } from 'payload'

export const experiencePage: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'experience-page',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Experience',
  title: 'Recent delivery history.',
  lead:
    'A short narrative of the work I’ve done recently, with emphasis on infrastructure, reliability, and practical shipping.',
  data: {
    sectionTitle: 'Delivery history',
    sectionLead: 'This page mirrors the compact, scannable structure of the homepage.',
  },
  layout: [],
}
