export const travelling = {
  slug: 'travelling',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Travelling.RossMoney.Me',
  title: 'Travelling round Southeast Asia in 2016.',
  lead:
    'This travelling project is the site for my 2016 Southeast Asia trip, built as a separate gallery stack around the photos I brought back from Thailand, Laos, Vietnam, Cambodia, South Korea, Japan, Hong Kong, and Australia.',
  focus: {
    kicker: 'Trip summary',
    title: '2016 route and archive',
    status: 'Published',
    items: [
      { label: 'Core region', value: 'Southeast Asia' },
      { label: 'Year', value: '2016' },
      { label: 'Format', value: 'Photo gallery' },
      { label: 'Source', value: 'PhotoPrism' },
    ],
  },
    data: {
      commitRepository: 'tekkifox/image-mosaic',
      commitBranch: 'main',
      liveUrl: 'https://travelling.rossmoney.me',
      metrics: [
      { value: 'PhotoPrism', label: 'Source library' },
      { value: 'Private API', label: 'Server-side URL mapping' },
      { value: 'Cached', label: 'Service worker and assets' },
    ],
    summaryTitle: 'An archive for revisiting the journey.',
    summaryLead:
      'PhotoPrism web app provides the image source, PHP and nginx serve a privacy-preserving API and shell, and a client-side gallery renders the final experience.',
    cards: [
      {
        kicker: 'Story',
        title: 'Round trip through Asia',
        text: 'I went travelling round Southeast Asia in 2016, then continued through South Korea, Japan, Hong Kong, and Australia.',
      },
      {
        kicker: 'Place',
        title: 'Route-based browsing',
        text: 'The gallery is grouped around the route and the places visited so the memories stay tied to the trip itself.',
      },
      {
        kicker: 'Format',
        title: 'Photo-first archive',
        text: 'It is closer to a curated image mosaic than a blog, with minimal text and a strong focus on the photos.',
      },
      {
        kicker: 'Audience',
        title: 'Personal reference',
        text: 'The site is mainly for revisiting the trip myself, while still being polished enough to share publicly.',
      },
    ],
    architecture: {
      eyebrow: 'Travel architecture feed',
      title: 'Architecture for travelling.rossmoney.me.',
    },
  },
  layout: [],
  meta: {
    title: 'Travelling',
    description: 'A visual archive of the 2016 Southeast Asia trip and related route notes.'
  },
} as any
