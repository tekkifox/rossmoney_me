import type { RequiredDataFromCollectionSlug } from 'payload'

export const home = {
  slug: 'home',
  _status: 'published',
  hero: {
    type: 'lowImpact',
    richText: {
      root: {
        type: 'root',
        children: [
          {
            type: 'heading',
            children: [
              {
                type: 'text',
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: 'Building dependable systems',
                version: 1,
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            tag: 'h1',
            version: 1,
          },
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: 'I design and ship resilient developer experiences, automation layers, and production-ready interfaces.',
                version: 1,
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            textFormat: 0,
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
      },
    },
    links: [
      { link: { type: 'custom', url: '/travelling', label: 'Travelling' } },
    ],
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
