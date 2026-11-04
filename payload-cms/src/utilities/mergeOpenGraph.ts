import type { Metadata } from 'next'

import {
  DEFAULT_OG_DESCRIPTION,
  OG_IMAGE_ALT,
  SITE_NAME,
  STATIC_OG_IMAGE_PATH,
} from './ogImage'
import { getSiteURL } from './siteURL'

const defaultOpenGraph: Metadata['openGraph'] = {
  type: 'website',
  description: DEFAULT_OG_DESCRIPTION,
  images: [
    {
      url: `${getSiteURL()}${STATIC_OG_IMAGE_PATH}`,
      alt: OG_IMAGE_ALT,
    },
  ],
  siteName: SITE_NAME,
  title: SITE_NAME,
}

export const mergeOpenGraph = (og?: Metadata['openGraph']): Metadata['openGraph'] => {
  return {
    ...defaultOpenGraph,
    ...og,
    images: og?.images ? og.images : defaultOpenGraph.images,
  }
}
