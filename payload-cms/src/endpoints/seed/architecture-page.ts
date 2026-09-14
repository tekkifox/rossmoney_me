import type { RequiredDataFromCollectionSlug } from 'payload'

export const architecture: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'architecture',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Live architecture example',
  title: 'Data streamed from the host Go service.',
  lead:
    'A live snapshot of the Docker daemon, Linux host telemetry, and service topology powering rossmoney.me.',
  data: {
    sectionTitle: 'Architecture at a glance',
    sectionLead:
      'This section is intentionally small: it surfaces the live deployment shape, the service list, and the host/container split used by the site.',
  },
  layout: [],
}
