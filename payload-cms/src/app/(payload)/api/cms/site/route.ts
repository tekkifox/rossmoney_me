import { NextResponse } from 'next/server';
import { getSafePayload } from '@/utilities/getSafePayload';

export async function GET() {
  try {
    const payload = await getSafePayload();
    const pClient = payload as any;
    const pages = await pClient.find({ collection: 'pages', limit: 100 });
    const projects = await pClient.find({ collection: 'projects', limit: 100, sort: 'order' });
    const experience = await pClient.find({ collection: 'experience', limit: 100, sort: 'order' });
    const headerDoc = await pClient.findGlobal({ slug: 'header' }).catch(() => ({ navItems: [] }));

    const homeDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'home') || {};
    const contactDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'contact') || {};
    const archDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'architecture') || {};
    const commitsDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'commits') || {};
    const workDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'work') || {};
    const expPageDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'experience-page') || {};
    const navDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'navigation') || {};

    const navLinks = (Array.isArray(headerDoc?.navItems) && headerDoc.navItems.length > 0)
      ? headerDoc.navItems.map((item: any) => {
          const l = item?.link || item;
          return {
            label: l?.label || l?.title || 'Link',
            href: l?.url || l?.href || '#'
          };
        })
      : (((navDoc as any).data as Record<string, unknown>)?.links || [
          { label: 'Work', href: '#work' },
          { label: 'Experience', href: '#experience' },
          { label: 'Architecture', href: '#architecture' },
          { label: 'Commits', href: '#commits' },
          { label: 'Contact', href: '#contact' }
        ]);

    return NextResponse.json({
      home: {
        eyebrow: (homeDoc as any).eyebrow,
        title: (homeDoc as any).title,
        lead: (homeDoc as any).lead,
        ...(((homeDoc as any).data as Record<string, unknown>) || {}),
        focus: (homeDoc as any).focus || ((homeDoc as any).data as any)?.focus
      },
      work: {
        eyebrow: (workDoc as any).eyebrow,
        title: (workDoc as any).title,
        ...(((workDoc as any).data as Record<string, unknown>) || {})
      },
      experiencePage: {
        eyebrow: (expPageDoc as any).eyebrow,
        title: (expPageDoc as any).title,
        ...(((expPageDoc as any).data as Record<string, unknown>) || {})
      },
      contact: {
        eyebrow: (contactDoc as any).eyebrow,
        title: (contactDoc as any).title,
        lead: (contactDoc as any).lead,
        ...(((contactDoc as any).data as Record<string, unknown>) || {})
      },
      architecture: {
        eyebrow: (archDoc as any).eyebrow,
        title: (archDoc as any).title,
        ...(((archDoc as any).data as Record<string, unknown>) || {})
      },
      commits: {
        eyebrow: (commitsDoc as any).eyebrow,
        title: (commitsDoc as any).title,
        ...(((commitsDoc as any).data as Record<string, unknown>) || {})
      },
      navigation: {
        ...(((navDoc as any).data as Record<string, unknown>) || {}),
        links: navLinks
      },
      navItems: navLinks,
      projects: projects.docs,
      experience: experience.docs,
      updatedAt: new Date().toISOString()
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
