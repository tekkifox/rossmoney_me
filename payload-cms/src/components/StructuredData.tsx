import React from 'react'

import { getSiteURL } from '@/utilities/siteURL'

const SITE_NAME = 'Ross Money - Developer & DevOps Portfolio'
const PERSON_NAME = 'Ross Money'
const PERSON_JOB_TITLE = 'DevOps-focused developer'
const SAME_AS = ['https://github.com/tekkifox', 'https://www.linkedin.com/in/rossmoney'] as const
const KNOWS_ABOUT = [
  'DevOps',
  'Platform engineering',
  'Site reliability engineering',
  'Software development',
  'Self-hosted infrastructure',
] as const

export const buildStructuredData = (siteURL: string = getSiteURL()) => {
  const personID = `${siteURL}/#person`
  const websiteID = `${siteURL}/#website`

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        '@id': personID,
        name: PERSON_NAME,
        url: `${siteURL}/`,
        jobTitle: PERSON_JOB_TITLE,
        sameAs: [...SAME_AS],
        knowsAbout: [...KNOWS_ABOUT],
      },
      {
        '@type': 'WebSite',
        '@id': websiteID,
        name: SITE_NAME,
        url: `${siteURL}/`,
        inLanguage: 'en',
        publisher: { '@id': personID },
        about: { '@id': personID },
      },
    ],
  }
}

/** Escape `<` so a value can never close the script element early. */
const serialise = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c')

/**
 * `Person` + `WebSite` JSON-LD for the public pages.
 *
 * Deliberately static: the site has no search, so there is no `SearchAction`.
 * Kept out of `layout.tsx` so it can be included by the public route without
 * touching the layout other workers are editing.
 */
export function StructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serialise(buildStructuredData()) }}
    />
  )
}

export default StructuredData
