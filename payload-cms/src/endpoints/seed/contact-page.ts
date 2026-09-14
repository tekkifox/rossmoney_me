import type { RequiredDataFromCollectionSlug } from 'payload'

export const contact: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'contact',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Contact',
  title: 'Open to platform, DevOps, and development work.',
  lead:
    'I am available for contract and full-time work, and I enjoy collaborating with teams to improve delivery and reliability.',
  data: {
    links: [
      { label: 'dev@rossmoney.me', href: 'mailto:dev@rossmoney.me' },
      { label: 'github.com/tekkifox', href: 'https://github.com/tekkifox' },
      { label: 'linkedin.com/in/rossmoney', href: 'https://www.linkedin.com/in/rossmoney' },
    ],
  },
  layout: [],
}
