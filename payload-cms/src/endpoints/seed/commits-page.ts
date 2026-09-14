import type { RequiredDataFromCollectionSlug } from 'payload'

export const commits: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'commits',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Recent commits',
  title: 'Last few GitHub commits from my portfolio repo.',
  lead:
    'A live commit feed showing the latest changes from rossmoney.me, used as a lightweight activity panel on the homepage.',
  data: {
    repository: 'tekkifox/rossmoney_me',
    branch: 'main',
  },
  layout: [],
}
