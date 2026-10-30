import type { Payload } from 'payload'

import type { Experience, Page, Project } from '@/payload-types'

import { getSafePayload } from '@/utilities/getSafePayload'
import { asRecord, asString, isObjectLike } from '@/utilities/json'

export interface NavLink {
  label: string
  href: string
}

export interface SiteFocusItem {
  label?: string | null
  value?: string | null
}

export interface SiteFocus {
  kicker?: string | null
  title?: string | null
  status?: string | null
  items?: SiteFocusItem[] | null
}

/**
 * A page as the templates consume it: the page document's own fields plus the
 * free-form `data` JSON blob flattened onto the section.
 */
export interface SiteSection {
  eyebrow?: string | null
  title?: string | null
  lead?: string | null
  liveUrl?: string | null
  archviewUrl?: string | null
  focus?: SiteFocus | null
  metrics?: unknown[]
  cards?: unknown[]
  summaryTitle?: string | null
  summaryLead?: string | null
  [key: string]: unknown
}

export interface AssembledSite {
  home: SiteSection
  work: SiteSection
  experiencePage: SiteSection
  contact: SiteSection
  travelling: SiteSection
  gameservers: SiteSection
  architecture: SiteSection
  commits: SiteSection
  navigation: SiteSection & { links?: NavLink[] }
  navItems?: NavLink[]
  projects: Project[]
  experience: Experience[]
  updatedAt: string
}

/** The subset of a page document that `assembleSite` reads. */
interface PageLike {
  slug?: string | null
  eyebrow?: string | null
  title?: string | null
  lead?: string | null
  data?: unknown
  focus?: SiteFocus | null
  liveUrl?: string | null
  archviewUrl?: string | null
}

function focusOf(value: unknown): SiteFocus | undefined {
  if (!isObjectLike(value)) return undefined

  const items = Array.isArray(value.items)
    ? value.items.filter(isObjectLike).map((item) => ({
        label: asString(item.label) ?? null,
        value: asString(item.value) ?? null,
      }))
    : undefined

  return {
    kicker: asString(value.kicker) ?? null,
    title: asString(value.title) ?? null,
    status: asString(value.status) ?? null,
    items,
  }
}

function navigationLinks(value: unknown): NavLink[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((entry) => {
    const link = asRecord(entry)
    return {
      label: asString(link.label) || 'Link',
      href: asString(link.href) || '#',
    }
  })
}

function findPage(pages: Page[], slug: string, alias?: string): PageLike {
  return pages.find((page) => page.slug === slug || (alias ? page.slug === alias : false)) ?? {}
}

export async function assembleSite(pClientArg?: Payload): Promise<AssembledSite> {
  const pClient = pClientArg ?? (await getSafePayload())

  const pages = await pClient.find({ collection: 'pages', limit: 100 })
  // The retired page documents are deliberately unpublished, but their data is
  // still part of the site payload (and the homepage). Fetch just those drafts
  // by slug so other pages keep their published-only behaviour.
  const retiredPageSlugs = ['commits', 'experience-page']
  const missingRetiredPages = retiredPageSlugs.filter(
    (slug) => !pages.docs.some((page) => page.slug === slug),
  )
  if (missingRetiredPages.length > 0) {
    const retiredDrafts = await pClient.find({
      collection: 'pages',
      limit: missingRetiredPages.length,
      draft: true,
      where: {
        slug: {
          in: missingRetiredPages,
        },
      },
    })
    pages.docs.push(...retiredDrafts.docs)
  }
  const projects = await pClient.find({ collection: 'projects', limit: 100, sort: 'order' })
  const experience = await pClient.find({ collection: 'experience', limit: 100, sort: 'order' })
  const headerDoc = await pClient.findGlobal({ slug: 'header' }).catch(() => ({ navItems: [] }))

  const homeDoc = findPage(pages.docs, 'home')
  const contactDoc = findPage(pages.docs, 'contact')
  const travellingDoc = findPage(pages.docs, 'travelling')
  // If travelling page is missing (eg. DB empty or not seeded), fall back to the seed data so templates render
  if (Object.keys(travellingDoc).length === 0) {
    try {
      const seedMod = await import('@/endpoints/seed/travelling-page')
      if (seedMod && seedMod.travelling) {
        // create a best-effort page-like object from the seed data
        // payload page docs usually contain eyebrow/title/lead/data/focus
        travellingDoc.eyebrow = seedMod.travelling.eyebrow
        travellingDoc.title = seedMod.travelling.title
        travellingDoc.lead = seedMod.travelling.lead
        travellingDoc.data = seedMod.travelling.data || {}
        travellingDoc.focus = seedMod.travelling.focus
      }
    } catch {
      // ignore if seed not available
    }
  }
  const archDoc = findPage(pages.docs, 'architecture')
  const commitsDoc = findPage(pages.docs, 'commits')
  const workDoc = findPage(pages.docs, 'work')
  const expPageDoc = findPage(pages.docs, 'experience-page')
  const navDoc = findPage(pages.docs, 'navigation')
  const gameserversDoc = findPage(pages.docs, 'game-servers', 'gameservers')

  const headerNavItems = Array.isArray(headerDoc?.navItems) ? headerDoc.navItems : []
  const navLinks: NavLink[] | undefined =
    headerNavItems.length > 0
      ? headerNavItems.map((item) => {
          const link = asRecord(asRecord(item).link ?? item)
          return {
            label: asString(link.label) || asString(link.title) || 'Link',
            href: asString(link.url) || asString(link.href) || '#',
          }
        })
      : navigationLinks(asRecord(navDoc.data).links)

  const travellingData = asRecord(travellingDoc.data)
  const gameserversData = asRecord(gameserversDoc.data)

  return {
    home: {
      eyebrow: homeDoc.eyebrow,
      title: homeDoc.title,
      lead: homeDoc.lead,
      ...asRecord(homeDoc.data),
      focus: focusOf(homeDoc.focus ?? asRecord(homeDoc.data).focus),
    },
    work: {
      eyebrow: workDoc.eyebrow,
      title: workDoc.title,
      ...asRecord(workDoc.data),
    },
    experiencePage: {
      eyebrow: expPageDoc.eyebrow,
      title: expPageDoc.title,
      ...asRecord(expPageDoc.data),
    },
    contact: {
      eyebrow: contactDoc.eyebrow,
      title: contactDoc.title,
      lead: contactDoc.lead,
      ...asRecord(contactDoc.data),
    },
    travelling: {
      eyebrow: travellingDoc.eyebrow,
      title: travellingDoc.title,
      lead: travellingDoc.lead,
      ...travellingData,
      // include top-level liveUrl if present on the page doc (sidebar field)
      liveUrl: asString(travellingDoc.liveUrl) || asString(travellingData.liveUrl),
      focus: focusOf(travellingDoc.focus ?? travellingData.focus),
    },
    gameservers: {
      eyebrow: gameserversDoc.eyebrow,
      title: gameserversDoc.title,
      lead: gameserversDoc.lead,
      ...gameserversData,
      // include top-level archviewUrl if present on the page doc (sidebar field)
      archviewUrl: asString(gameserversDoc.archviewUrl) || asString(gameserversData.archviewUrl),
      focus: focusOf(gameserversDoc.focus ?? gameserversData.focus),
    },
    architecture: {
      eyebrow: archDoc.eyebrow,
      title: archDoc.title,
      ...asRecord(archDoc.data),
    },
    commits: {
      eyebrow: commitsDoc.eyebrow,
      title: commitsDoc.title,
      ...asRecord(commitsDoc.data),
    },
    navigation: {
      ...asRecord(navDoc.data),
      links: navLinks,
    },
    navItems: navLinks,
    projects: projects.docs,
    experience: experience.docs,
    updatedAt: new Date().toISOString(),
  }
}
