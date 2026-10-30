import type { Payload } from 'payload'

/**
 * Paths that must never be advertised in a sitemap.
 *
 * The header is the source of truth for which pages a visitor can reach, but a
 * handful of routes are deliberately kept out of search results even when a
 * navigation item points at them. This is the single list used by both the
 * dynamic route and the build-time generator.
 */
export const SITEMAP_EXCLUDED_PATHS = [
  '/posts',
  '/search',
  // Legacy alias for `/experience`; it is never a canonical destination.
  '/experience-page',
] as const

const EXCLUDED_PATHS = new Set<string>(SITEMAP_EXCLUDED_PATHS)

/** True when `path` is one of the excluded routes. Trailing slashes are ignored. */
export function isSitemapExcluded(path: string): boolean {
  const comparable = path.length > 1 ? path.replace(/\/+$/, '') : path
  return EXCLUDED_PATHS.has(comparable)
}

type ReferenceValue =
  | string
  | number
  | {
      id?: string | number | null
      slug?: string | null
      _status?: string | null
    }
  | null
  | undefined

export interface SitemapHeaderLink {
  type?: 'reference' | 'custom' | null
  url?: string | null
  reference?: {
    relationTo?: string | null
    value?: ReferenceValue
  } | null
}

export interface SitemapHeader {
  navItems?: Array<{ link?: SitemapHeaderLink | null } | null> | null
}

/** `${collection}:${id}` -> published slug. */
export type PublishedReferenceIndex = ReadonlyMap<string, string>

export type SitemapPayload = Pick<Payload, 'findGlobal' | 'find'>

/**
 * Fallback used by the build-time generator (and by a runtime without a
 * database), which cannot read the `header` global.
 *
 * It mirrors the two header definitions in the repository:
 *  - `src/payload.config.ts` seeds `/#work`, `/travelling`, `/game-servers`,
 *    `/#experience`, `/#architecture`, `/cv` and `/contact`;
 *  - `src/endpoints/seed/index.ts` seeds reference links to the Services and
 *    Contact pages.
 *
 * The Services page is seeded as a draft, so a reference to it is not emitted
 * by the live resolver; after expanding anchors and de-duplicating, both
 * definitions reduce to the paths below. Keep this list in step with those
 * headers if the seeded navigation changes.
 */
const FALLBACK_HEADER: SitemapHeader = {
  navItems: [
    { link: { type: 'custom', url: '/#work' } },
    { link: { type: 'custom', url: '/travelling' } },
    { link: { type: 'custom', url: '/game-servers' } },
    { link: { type: 'custom', url: '/#experience' } },
    { link: { type: 'custom', url: '/#architecture' } },
    { link: { type: 'custom', url: '/cv' } },
    { link: { type: 'custom', url: '/contact' } },
    // The seed endpoint links to Services, but that page is seeded unpublished,
    // so the live resolver would skip it. Keep it in the fallback shape as the
    // same draft reference rather than advertising a page the header hides.
    {
      link: {
        type: 'reference',
        reference: {
          relationTo: 'pages',
          value: { slug: 'services', _status: 'draft' },
        },
      },
    },
  ],
}

/**
 * Turn a custom link into a sitemap path.
 *
 * Only site-relative URLs are eligible. Absolute URLs point at another site and
 * a protocol-relative URL has no local path to advertise, so both are skipped.
 * A fragment names a section that also exists as a full page, so it is expanded
 * to that variant: `/#work` becomes `/work`, `/#architecture` becomes
 * `/architecture`, and `/#experience` becomes `/experience`. Query strings are
 * dropped, and a non-root path keeps its own pathname (`/travelling#notes`
 * becomes `/travelling`).
 */
function customPath(url: string | null | undefined): string | null {
  if (!url) return null

  let trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) return null

  // A bare fragment (`#work`) describes the homepage section in exactly the
  // same way as `/#work`; normalise it before splitting.
  if (trimmed.startsWith('#')) trimmed = `/${trimmed}`

  if (!trimmed.startsWith('/')) return null

  const hashIndex = trimmed.indexOf('#')
  const fragment = hashIndex >= 0 ? trimmed.slice(hashIndex + 1).split('?', 1)[0] : ''
  const withoutFragment = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed
  const path = withoutFragment.split('?', 1)[0]

  if (!path) return null

  if (fragment && path === '/') return `/${fragment}`

  return path
}

function referenceId(value: ReferenceValue): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value.id === null || value.id === undefined) return null
  return String(value.id)
}

function referencePath(relationTo: 'pages' | 'posts', slug: string): string {
  if (relationTo === 'pages') return `/${slug}`
  return `/posts/${slug}`
}

function resolveReferencePath(
  reference: NonNullable<SitemapHeaderLink['reference']>,
  published?: PublishedReferenceIndex,
): string | null {
  const relationTo = reference.relationTo ?? 'pages'
  if (relationTo !== 'pages' && relationTo !== 'posts') return null

  const value = reference.value
  const id = referenceId(value)

  // With an index we can verify publication, which the populated document may
  // not expose. The index is authoritative whenever it is supplied.
  if (published !== undefined) {
    if (!id) return null
    const slug = published.get(`${relationTo}:${id}`)
    return slug ? referencePath(relationTo, slug) : null
  }

  // A populated, non-draft document is the next best thing; a bare id cannot
  // be resolved without a client.
  if (value && typeof value === 'object' && value._status !== 'draft' && value.slug) {
    return referencePath(relationTo, value.slug)
  }

  return null
}

/**
 * Pure half of the resolver: turn a header global (or a header-shaped object)
 * into ordered, de-duplicated site paths after applying the exclusions.
 *
 * `published` is optional so the function can also be used with an already
 * populated header. When it is supplied it wins: a reference is only included
 * if its id is present in the index.
 */
export function pathsFromHeader(
  header: SitemapHeader | null | undefined,
  published?: PublishedReferenceIndex,
): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  for (const item of header?.navItems ?? []) {
    const link = item?.link
    if (!link) continue

    let path: string | null = null

    if (link.type === 'reference' || (!link.type && link.reference)) {
      if (link.reference) path = resolveReferencePath(link.reference, published)
    } else if (link.type === 'custom') {
      path = customPath(link.url)
    }

    if (!path) continue

    // Compare without a trailing slash so `/posts/` cannot sneak past the
    // exclusions, but keep the header's spelling for every other path.
    if (isSitemapExcluded(path) || seen.has(path)) continue

    seen.add(path)
    paths.push(path)
  }

  return paths
}

function collectReferenceIds(header: SitemapHeader): Map<'pages' | 'posts', Set<string>> {
  const ids = new Map<'pages' | 'posts', Set<string>>([
    ['pages', new Set()],
    ['posts', new Set()],
  ])

  for (const item of header.navItems ?? []) {
    const reference = item?.link?.reference
    if (!reference) continue

    const relationTo = reference.relationTo ?? 'pages'
    if (relationTo !== 'pages' && relationTo !== 'posts') continue

    const id = referenceId(reference.value)
    if (id) ids.get(relationTo)?.add(id)
  }

  return ids
}

async function loadPublishedIndex(
  payload: SitemapPayload,
  idsByCollection: Map<'pages' | 'posts', Set<string>>,
): Promise<PublishedReferenceIndex> {
  const index = new Map<string, string>()

  for (const [collection, ids] of idsByCollection) {
    if (ids.size === 0) continue

    try {
      const result = (await payload.find({
        collection,
        depth: 0,
        draft: false,
        limit: ids.size,
        pagination: false,
        where: {
          and: [{ id: { in: Array.from(ids) } }, { _status: { equals: 'published' } }],
        },
        select: { slug: true },
      })) as { docs?: Array<{ id?: string | number; slug?: string | null }> }

      for (const doc of result.docs ?? []) {
        if (doc.id === undefined || doc.id === null || !doc.slug) continue
        index.set(`${collection}:${String(doc.id)}`, doc.slug)
      }
    } catch {
      // A failed lookup only drops the affected references; custom links and
      // other collections still resolve.
    }
  }

  return index
}

/**
 * Resolve the paths the global header links to.
 *
 * Without a Payload client (the build-time generator, or a DB-less build) the
 * documented seeded-header fallback is used. A client that returns no global
 * data at all is treated the same way; a global that exists but has no nav
 * items deliberately produces an empty sitemap.
 */
export async function resolveHeaderSitemapPaths(
  payload?: SitemapPayload | null,
): Promise<string[]> {
  if (!payload) return pathsFromHeader(FALLBACK_HEADER)

  let header: SitemapHeader
  try {
    header = (await payload.findGlobal({ slug: 'header', depth: 0 })) as SitemapHeader
  } catch {
    return pathsFromHeader(FALLBACK_HEADER)
  }

  if (!header || Object.keys(header).length === 0) {
    return pathsFromHeader(FALLBACK_HEADER)
  }

  const published = await loadPublishedIndex(payload, collectReferenceIds(header))
  return pathsFromHeader(header, published)
}
