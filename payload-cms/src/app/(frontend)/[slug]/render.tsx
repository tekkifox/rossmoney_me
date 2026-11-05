import type { Metadata } from 'next'

import { PayloadRedirects } from '@/components/PayloadRedirects'
import { AckeeTracker } from '@/components/AckeeTracker'
import { getSafePayload } from '@/utilities/getSafePayload'
import type { RequiredDataFromCollectionSlug } from 'payload'
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
import { StructuredData } from '@/components/StructuredData'
import { browserArchitectureApi, browserArchitectureProject } from '@/utilities/architectureURL'
import { resolvePageArchviewSource, isArchviewSourceFailure } from '@/utilities/archviewPageSource'
import { populateCvFile } from '@/utilities/cvPageFile'
import { resolvePageTemplate } from '@/utilities/pageTemplates'

type RenderPageArgs = {
  slug: string
  /**
   * Draft-mode requests come from the dynamic preview route; normal visitors
   * always render published content. This is the only input that changes the
   * query's access level.
   */
  draft: boolean
  /**
   * Analytics is rendered by the page rather than the layout so the layout
   * stays free of request-time state. The preview route passes `false`.
   */
  track: boolean
}

/**
 * Shared renderer for the public `[slug]` route and the draft preview route.
 *
 * The public page never reads `draftMode()`: doing so would force the entire
 * route dynamic and bring back `private, no-store`. Draft requests are routed
 * here by `proxy.ts` with `draft: true` instead.
 */
export async function renderPage({ slug, draft, track }: RenderPageArgs) {
  const decodedSlug = decodeURIComponent(slug)
  const url = '/' + decodedSlug
  let page: RequiredDataFromCollectionSlug<'pages'> | null

  page = await queryPageBySlug({
    slug: decodedSlug,
    draft,
  })

  // Remove this code once your website is seeded
  if (!page && decodedSlug === 'home') {
    page = homeStatic
  }

  if (!page) {
    return <PayloadRedirects url={url} />
  }

  const payload = await getSafePayload()
  // A shallow query (or a cached shell built from one) hands the viewer an id
  // instead of the CV media document. Resolve it here so the download and the
  // stored HTML never depend on the caller's depth.
  page = await populateCvFile(payload, page)

  const resolvedSource = await resolvePageArchviewSource(page, null, {
    payload,
  })
  const resolvedOrigin =
    resolvedSource && !isArchviewSourceFailure(resolvedSource) ? resolvedSource.origin : undefined
  const resolvedProject =
    resolvedSource && !isArchviewSourceFailure(resolvedSource) ? resolvedSource.project : undefined
  const forceSource =
    resolvedSource !== null &&
    !isArchviewSourceFailure(resolvedSource) &&
    (resolvedSource.kind === 'relation' || resolvedSource.kind === 'default')
  const architectureFailed = resolvedSource !== null && isArchviewSourceFailure(resolvedSource)
  const architectureApi = architectureFailed
    ? ''
    : browserArchitectureApi(resolvedOrigin, process.env, {
        forceSource,
      })
  const architectureProject = browserArchitectureProject(resolvedProject)

  // The page's own `template` field decides how it renders. Documents created
  // before that field existed have no value, so `resolvePageTemplate` applies
  // the old slug chain as a transitional fallback (see pageTemplates.ts) until
  // the backfill or an editor sets one. An unknown value renders generically.
  const template = resolvePageTemplate(page)

  return (
    <>
      {track && <AckeeTracker draft={draft} />}
      <PageRoot architectureApi={architectureApi} architectureProject={architectureProject} architectureUnavailable={architectureFailed}>
        <StructuredData />
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
    </>
  )
}

/** Metadata for either the published document or its draft, per `draft`. */
export async function generatePageMetadata({
  slug,
  draft,
}: Pick<RenderPageArgs, 'slug' | 'draft'>): Promise<Metadata> {
  const page = await queryPageBySlug({
    slug: decodeURIComponent(slug),
    draft,
  })

  return generateMeta({ doc: page })
}

const queryPageBySlug = cache(
  async ({ slug, draft }: { slug: string; draft: boolean }) => {
    try {
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
  },
)
