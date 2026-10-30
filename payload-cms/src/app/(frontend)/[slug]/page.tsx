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
import NavigationTemplate from '../templates/navigation'
import CVTemplate from '../templates/cv'
import GameServersTemplate from '../templates/game-servers'
import ServicesTemplate from '../templates/services'
import { PageMeta } from '../templates/shared'
import { browserArchitectureApi } from '@/utilities/architectureURL'
import { resolvePageArchviewSource } from '@/utilities/archviewPageSource'

// This page intentionally uses dynamic data from the internal architecture API
// Mark as force-dynamic so Next allows runtime fetches without static/dynamic runtime warnings
export const dynamic = 'force-dynamic'

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
      ?.filter((doc: { slug?: string | null }) => {
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
    page = homeStatic
  }

  if (!page) {
    return <PayloadRedirects url={url} />
  }

  const resolvedSource = await resolvePageArchviewSource(page, null, {
    payload: await getSafePayload(),
  })
  const architectureApi = browserArchitectureApi(resolvedSource?.origin, process.env, {
    forceSource:
      resolvedSource?.kind === 'relation' || resolvedSource?.kind === 'default',
  })

  return (
    <article id="page-root" className="pt-16 pb-24" data-architecture-api={architectureApi}>
      <PageMeta page={page} architectureApi={architectureApi} />
      <PageClient />
      {/* Allows redirects for valid pages too */}
      <PayloadRedirects disableNotFound url={url} />

      {draft && <LivePreviewListener />}

      {page.slug === 'home' && <HomeTemplate page={page} />}
      {page.slug === 'contact' && <ContactTemplate page={page} />}
      {page.slug === 'travelling' && <TravellingTemplate page={page} />}
      {page.slug === 'navigation' && <NavigationTemplate page={page} />}
      {page.slug === 'cv' && <CVTemplate page={page} />}
      {page.slug === 'services' && <ServicesTemplate page={page} />}
      {(page.slug === 'game-servers' || page.slug === 'gameservers') && <GameServersTemplate page={page} />}
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
