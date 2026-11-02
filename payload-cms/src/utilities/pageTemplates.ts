/**
 * The templates a page can render with, and the one place that decides which
 * template a document gets.
 *
 * `pages.template` is the source of truth. `resolvePageTemplate` keeps a
 * slug-based fallback for documents created before that field existed; see the
 * comment on the fallback below. Keep `PAGE_TEMPLATES` in step with the
 * template modules in `src/app/(frontend)/templates/`.
 */
export const PAGE_TEMPLATES = [
  'home',
  'contact',
  'cv',
  'travelling',
  'services',
  'game-servers',
  'navigation',
  'map',
  'default',
] as const

export type PageTemplate = (typeof PAGE_TEMPLATES)[number]

export const DEFAULT_PAGE_TEMPLATE: PageTemplate = 'default'

export const PAGE_TEMPLATE_OPTIONS: Array<{ label: string; value: PageTemplate }> = [
  { label: 'Home', value: 'home' },
  { label: 'Contact', value: 'contact' },
  { label: 'CV', value: 'cv' },
  { label: 'Travelling', value: 'travelling' },
  { label: 'Services', value: 'services' },
  { label: 'Game servers', value: 'game-servers' },
  { label: 'Navigation', value: 'navigation' },
  { label: 'Map', value: 'map' },
  { label: 'Default (generic page)', value: 'default' },
]

/**
 * The mapping the route used to hardcode. It is only consulted when a document
 * has no `template` value yet, so existing pages keep rendering exactly as they
 * did until the backfill (or an editor) sets the field. New pages should always
 * store a template; `default` renders any page generically.
 */
const SLUG_TEMPLATES: Record<string, PageTemplate> = {
  home: 'home',
  contact: 'contact',
  cv: 'cv',
  travelling: 'travelling',
  services: 'services',
  'game-servers': 'game-servers',
  gameservers: 'game-servers',
  navigation: 'navigation',
  map: 'map',
}

export function isPageTemplate(value: unknown): value is PageTemplate {
  return typeof value === 'string' && (PAGE_TEMPLATES as readonly string[]).includes(value)
}

/** Template the old hardcoded route chain gave a slug, if any. */
export function templateFromSlug(slug: string | null | undefined): PageTemplate | undefined {
  if (!slug) return undefined
  return SLUG_TEMPLATES[slug]
}

/**
 * Resolve a page's template from its own data.
 *
 * - A recognised `template` wins.
 * - A value that is set but not recognised (for example, a template removed in
 *   a later release) renders the generic template rather than nothing.
 * - No value at all falls back to the old slug chain, then to generic.
 */
export function resolvePageTemplate(page: {
  template?: string | null
  slug?: string | null
}): PageTemplate {
  if (typeof page.template === 'string' && page.template.trim() !== '') {
    return isPageTemplate(page.template) ? page.template : DEFAULT_PAGE_TEMPLATE
  }

  return templateFromSlug(page.slug) ?? DEFAULT_PAGE_TEMPLATE
}
