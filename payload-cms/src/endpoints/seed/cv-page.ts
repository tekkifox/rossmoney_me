import type { RequiredDataFromCollectionSlug } from 'payload'

export const cv: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'cv',
  _status: 'published',
  // The CV page is a single CV viewer, so it explicitly opts out of the hero.
  hero: {
    type: 'none',
  },
  title: 'CV',
  eyebrow: 'My CV',
  lead: 'Download or view my curriculum vitae.',
  data: {},
  meta: {
    title: 'CV',
    description: 'Curriculum Vitae',
  },
}
