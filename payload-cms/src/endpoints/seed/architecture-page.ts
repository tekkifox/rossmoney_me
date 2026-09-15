import type { RequiredDataFromCollectionSlug } from 'payload'

export const architecture: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'architecture',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Live architecture example',
  title: 'Live architecture snapshot',
  lead:
    'A live snapshot of the service topology and deployment shape for the travelling project.',
  data: {
    sectionTitle: 'Architecture at a glance',
    sectionLead:
      'This section is intentionally small: it surfaces the live deployment shape and the service inventory used by the site.',
  },
  layout: [],
}
