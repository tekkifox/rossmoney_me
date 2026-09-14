export const travelling = {
  slug: 'travelling',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Travelling',
  title: 'Travelling round Southeast Asia in 2016.',
  lead:
    'A visual archive from the 2016 journey through Thailand, Laos, Vietnam, Cambodia, South Korea, Japan, Hong Kong, and Australia.',
  focus: {
    kicker: 'Trip summary',
    title: '2016 route and archive',
    status: 'Published',
    items: [
      { label: 'Core region', value: 'Southeast Asia' },
      { label: 'Year', value: '2016' },
      { label: 'Format', value: 'Photo archive' },
      { label: 'Source', value: 'PhotoPrism' },
    ],
  },
  data: {
    commitRepository: 'tekkifox/image-mosaic',
    commitBranch: 'main',
    metrics: [
      { value: 'PhotoPrism', label: 'Source library' },
      { value: 'Private API', label: 'Server-side URL mapping' },
      { value: 'Cached', label: 'Service worker and assets' },
    ],
    summaryTitle: 'A private archive for revisiting the journey.',
    summaryLead:
      'The travelling project is a separate gallery stack built to revisit the trip cleanly, with PhotoPrism as the photo source and a privacy-preserving API layer around the images.',
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
} as any
