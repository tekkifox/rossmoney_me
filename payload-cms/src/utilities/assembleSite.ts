import { getSafePayload } from '@/utilities/getSafePayload'

export async function assembleSite(pClientArg?: any) {
  const pClient = pClientArg ?? (await getSafePayload())

  const pages = await pClient.find({ collection: 'pages', limit: 100 })
  const projects = await pClient.find({ collection: 'projects', limit: 100, sort: 'order' })
  const experience = await pClient.find({ collection: 'experience', limit: 100, sort: 'order' })
  const headerDoc = await pClient.findGlobal({ slug: 'header' }).catch(() => ({ navItems: [] }))

  const homeDoc = pages.docs.find((p: any) => p.slug === 'home') || {}
  const contactDoc = pages.docs.find((p: any) => p.slug === 'contact') || {}
  let travellingDoc = pages.docs.find((p: any) => p.slug === 'travelling') || {}
  // If travelling page is missing (eg. DB empty or not seeded), fall back to the seed data so templates render
  if (!travellingDoc || Object.keys(travellingDoc).length === 0) {
    try {
      const seedMod = await import('@/endpoints/seed/travelling-page')
      // seed exports `travelling`
      // cast to any to match the shape
      // only override when seed exists
      if (seedMod && seedMod.travelling) {
        // copy seed into travellingDoc shape expected by templates
        // keep slug/status if present in seed
        // ensure travellingDoc looks like a page doc
        const s = seedMod.travelling as any
        // create a best-effort page-like object
        // payload page docs usually contain eyebrow/title/lead/data/focus
        // we'll map seed fields into that shape
        // This fallback is only used when the DB does not have a travelling page
        // so templates still receive meaningful defaults
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        travellingDoc = {
          slug: s.slug || 'travelling',
          _status: s._status || 'published',
          eyebrow: s.eyebrow,
          title: s.title,
          lead: s.lead,
          data: s.data || {},
          focus: s.focus || (s.data && s.data.focus) || undefined,
        }
      }
    } catch (e) {
      // ignore if seed not available
    }
  }
  const archDoc = pages.docs.find((p: any) => p.slug === 'architecture') || {}
  const commitsDoc = pages.docs.find((p: any) => p.slug === 'commits') || {}
  const workDoc = pages.docs.find((p: any) => p.slug === 'work') || {}
  const expPageDoc = pages.docs.find((p: any) => p.slug === 'experience-page') || {}
  const navDoc = pages.docs.find((p: any) => p.slug === 'navigation') || {}

  const navLinks = (Array.isArray(headerDoc?.navItems) && headerDoc.navItems.length > 0)
    ? headerDoc.navItems.map((item: any) => {
        const l = item?.link || item
        return {
          label: l?.label || l?.title || 'Link',
          href: l?.url || l?.href || '#',
        }
      })
    : (((navDoc as any).data as Record<string, unknown>)?.links)

  return {
    home: {
      eyebrow: (homeDoc as any).eyebrow,
      title: (homeDoc as any).title,
      lead: (homeDoc as any).lead,
      ...(((homeDoc as any).data as Record<string, unknown>) || {}),
      focus: (homeDoc as any).focus || ((homeDoc as any).data as any)?.focus,
    },
    work: {
      eyebrow: (workDoc as any).eyebrow,
      title: (workDoc as any).title,
      ...(((workDoc as any).data as Record<string, unknown>) || {}),
    },
    experiencePage: {
      eyebrow: (expPageDoc as any).eyebrow,
      title: (expPageDoc as any).title,
      ...(((expPageDoc as any).data as Record<string, unknown>) || {}),
    },
    contact: {
      eyebrow: (contactDoc as any).eyebrow,
      title: (contactDoc as any).title,
      lead: (contactDoc as any).lead,
      ...(((contactDoc as any).data as Record<string, unknown>) || {}),
    },
    travelling: {
      eyebrow: (travellingDoc as any).eyebrow,
      title: (travellingDoc as any).title,
      lead: (travellingDoc as any).lead,
      ...(((travellingDoc as any).data as Record<string, unknown>) || {}),
      focus: (travellingDoc as any).focus || ((travellingDoc as any).data as any)?.focus,
    },
    architecture: {
      eyebrow: (archDoc as any).eyebrow,
      title: (archDoc as any).title,
      ...(((archDoc as any).data as Record<string, unknown>) || {}),
    },
    commits: {
      eyebrow: (commitsDoc as any).eyebrow,
      title: (commitsDoc as any).title,
      ...(((commitsDoc as any).data as Record<string, unknown>) || {}),
    },
    navigation: {
      ...(((navDoc as any).data as Record<string, unknown>) || {}),
      links: navLinks,
    },
    navItems: navLinks,
    projects: projects.docs,
    experience: experience.docs,
    updatedAt: new Date().toISOString(),
  }
}
