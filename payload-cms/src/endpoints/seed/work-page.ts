import type { RequiredDataFromCollectionSlug } from 'payload'

export const work: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'work',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Selected work',
  title: 'Real roles and projects from my CV.',
  lead:
    'A curated summary of roles, responsibilities, and projects spanning PHP, DevOps, infrastructure, and delivery work.',
  data: {
    sectionTitle: 'Career highlights',
    sectionLead: 'The page is fed from CMS data so the work history can evolve without editing the app shell.',
  },
  layout: [],
}
