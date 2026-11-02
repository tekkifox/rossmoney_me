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
import MapTemplate from '../templates/map'
import DefaultTemplate from '../templates/default'
import { PageMeta } from '../templates/shared'
import { PageRoot } from '@/components/PageRoot'
import { browserArchitectureApi, browserArchitectureProject } from '@/utilities/architectureURL'
import { resolvePageArchviewSource } from '@/utilities/archviewPageSource'
import { resolvePageTemplate } from '@/utilities/pageTemplates'

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
  const architectureProject = browserArchitectureProject(resolvedSource?.project)

  // The page's own `template` field decides how it renders. Documents created
  // before that field existed have no value, so `resolvePageTemplate` applies
  // the old slug chain as a transitional fallback (see pageTemplates.ts) until
  // the backfill or an editor sets one. An unknown value renders generically.
  const template = resolvePageTemplate(page)

  return (
    <PageRoot architectureApi={architectureApi} architectureProject={architectureProject}>
      <PageMeta page={page} architectureApi={architectureApi} />
      <PageClient />
      {/* Allows redirects for valid pages too */}
      <PayloadRedirects disableNotFound url={url} />

      {draft && <LivePreviewListener />}

      {template === 'home' && <HomeTemplate page={page} />}
      {template === 'contact' && <ContactTemplate page={page} />}
      {template === 'travelling' && <TravellingTemplate page={page} />}
      {template === 'navigation' && <NavigationTemplate page={page} />}
      {template === 'cv' && <CVTemplate page={page} />}
      {template === 'services' && <ServicesTemplate page={page} />}
      {template === 'map' && <MapTemplate page={page} />}
      {template === 'game-servers' && <GameServersTemplate page={page} />}
      {template === 'default' && <DefaultTemplate page={page} />}
    </PageRoot>
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
