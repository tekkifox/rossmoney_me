import type { RequiredDataFromCollectionSlug } from 'payload'

export const home = {
  slug: 'home',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Available for devops and developer roles',
  title: 'Building dependable systems with operational discipline.',
  lead:
    'I design and ship resilient developer experiences, automation layers, and production-ready interfaces. This portfolio can now be edited in Payload CMS and persisted in MongoDB.',
  focus: {
    kicker: 'Current focus',
    title: 'Building personal infrastructure',
    status: 'Live',
    items: [
      { label: 'Role', value: 'DevOps-focused developer working on personal projects' },
      { label: 'Specialty', value: 'Storage servers, media servers, and reliable self-hosted services' },
      { label: 'Current build', value: 'Custom connectors and tooling for homelab and service automation' },
      { label: 'Delivery model', value: 'Small iterations, practical ops, and systems I can run myself' },
    ],
  },
  data: {
    primaryButton: { label: 'Start a conversation', href: '#contact' },
    secondaryButton: { label: 'Inspect live architecture', href: '#architecture' },
    metrics: [
      { value: '99.95%', label: 'availability target' },
      { value: '24/7', label: 'operations mindset' },
      { value: 'DX', label: 'developer experience focus' },
    ],
  },
  layout: [],
} as any
