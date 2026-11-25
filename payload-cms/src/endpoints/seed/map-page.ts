import type { RequiredDataFromCollectionSlug } from 'payload'

/**
 * The public architecture map. The `map` template fetches the live diagram and
 * legend from the application itself, so the seeded document only carries the
 * copy. Keep the focus values descriptive (“one”, “private”, “five”): real
 * hostnames and addresses do not belong in the public repository.
 */
export const mapPage: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'map',
  template: 'map',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Architecture',
  title: 'Map',
  lead:
    'How the platform fits together: one public edge, a private encrypted mesh, the hosts by role, and the managed data stores behind them.',
  focus: {
    kicker: 'Architecture',
    title: 'How it fits together',
    status: 'Draft',
    items: [
      { label: 'Public entry', value: 'one' },
      { label: 'Mesh', value: 'private' },
      { label: 'Hosts', value: 'five' },
    ],
  },
  layout: [],
  meta: {
    title: 'Map',
    description:
      'A public, sanitised diagram of the platform architecture: one public edge, a private mesh, five hosts by role, and the managed data stores.',
  },
}
