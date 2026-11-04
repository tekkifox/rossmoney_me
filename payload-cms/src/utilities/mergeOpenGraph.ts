import type { Metadata } from 'next'
import { getSiteURL } from './siteURL'

const defaultOpenGraph: Metadata['openGraph'] = {
  type: 'website',
  description: 'Ross Money — DevOps-focused developer. Portfolio showcasing projects, infrastructure, and tooling.',
  images: [
    {
      url: `${getSiteURL()}/og.png`,
      alt: 'Ross Money — DevOps-focused developer portfolio',
    },
  ],
  siteName: 'Ross Money - Developer & DevOps Portfolio',
  title: 'Ross Money - Developer & DevOps Portfolio',
}

export const mergeOpenGraph = (og?: Metadata['openGraph']): Metadata['openGraph'] => {
  return {
    ...defaultOpenGraph,
    ...og,
    images: og?.images ? og.images : defaultOpenGraph.images,
  }
}
