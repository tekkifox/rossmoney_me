import type { Metadata } from 'next'

import { PayloadRedirects } from '@/components/PayloadRedirects'
import { getSafePayload } from '@/utilities/getSafePayload'
import type { RequiredDataFromCollectionSlug } from 'payload'
import { draftMode } from 'next/headers'
import React, { cache } from 'react'
import { homeStatic } from '@/endpoints/seed/home-static'

import { generateMeta } from '@/utilities/generateMeta'
import PageClient from './page.client'
import { LivePreviewListener } from '@/components/LivePreviewListener'
import HomeTemplate from '../templates/home'
import ContactTemplate from '../templates/contact'
import TravellingTemplate from '../templates/travelling'
import ArchitectureTemplate from '../templates/architecture'
import CommitsTemplate from '../templates/commits'
import WorkTemplate from '../templates/work'
import ExperiencePageTemplate from '../templates/experience-page'
import NavigationTemplate from '../templates/navigation'
import { loadCollections } from '../templates/shared'

export async function generateStaticParams() {
  try {
    const payload = await getSafePayload()
    const pages = await payload.find({
      collection: 'pages',
      draft: false,
      limit: 1000,
      overrideAccess: false,
      pagination: false,
      select: {
        slug: true,
      },
    })

    const params = pages.docs
      ?.filter((doc: any) => {
        return doc.slug !== 'home'
      })
      .map(({ slug }: { slug: string }) => {
        return { slug }
      })

    return params
  } catch {
    return []
  }
}

type Args = {
  params: Promise<{
    slug?: string
  }>
}

export default async function Page({ params: paramsPromise }: Args) {
  const { isEnabled: draft } = await draftMode()
  const { slug = 'home' } = await paramsPromise
  // Decode to support slugs with special characters
  const decodedSlug = decodeURIComponent(slug)
  const url = '/' + decodedSlug
  let page: RequiredDataFromCollectionSlug<'pages'> | null

  page = await queryPageBySlug({
    slug: decodedSlug,
  })

  // Remove this code once your website is seeded
  if (!page && slug === 'home') {
    page = homeStatic as any
  }

  if (!page) {
    return <PayloadRedirects url={url} />
  }

  const collections = page.slug === 'work' || page.slug === 'experience-page' ? await loadCollections() : null

  return (
    <article className="pt-16 pb-24">
      <PageClient />
      {/* Allows redirects for valid pages too */}
      <PayloadRedirects disableNotFound url={url} />

      {draft && <LivePreviewListener />}

      {page.slug === 'home' && <HomeTemplate page={page} />}
      {page.slug === 'contact' && <ContactTemplate page={page} />}
      {page.slug === 'travelling' && <TravellingTemplate page={page} />}
      {page.slug === 'architecture' && <ArchitectureTemplate page={page} />}
      {page.slug === 'commits' && <CommitsTemplate page={page} />}
      {page.slug === 'work' && <WorkTemplate page={page} projects={collections?.projects || []} />}
      {page.slug === 'experience-page' && <ExperiencePageTemplate page={page} experience={collections?.experience || []} />}
      {page.slug === 'navigation' && <NavigationTemplate page={page} />}
    </article>
  )
}

export async function generateMetadata({ params: paramsPromise }: Args): Promise<Metadata> {
  const { slug = 'home' } = await paramsPromise
  // Decode to support slugs with special characters
  const decodedSlug = decodeURIComponent(slug)
  const page = await queryPageBySlug({
    slug: decodedSlug,
  })

  return generateMeta({ doc: page })
}

const queryPageBySlug = cache(async ({ slug }: { slug: string }) => {
  try {
    const { isEnabled: draft } = await draftMode()

    const payload = await getSafePayload()

    const result = await payload.find({
      collection: 'pages',
      draft,
      limit: 1,
      pagination: false,
      overrideAccess: draft,
      where: {
        slug: {
          equals: slug,
        },
      },
    })

    return result.docs?.[0] || null
  } catch {
    return null
  }
})
