import { NextResponse } from 'next/server';
import { getSafePayload } from '@/utilities/getSafePayload';

export async function GET() {
  try {
    const payload = await getSafePayload();
    const pClient = payload as any;
    const pages = await pClient.find({ collection: 'pages', limit: 100 });
    const headerDoc = await pClient.findGlobal({ slug: 'header' }).catch(() => ({ navItems: [] }));

    const travellingDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'travelling') || {};
    const navDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'navigation') || {};

    const navLinks = (Array.isArray(headerDoc?.navItems) && headerDoc.navItems.length > 0)
      ? headerDoc.navItems.map((item: any) => {
          const l = item?.link || item;
          return {
            label: l?.label || l?.title || 'Link',
            href: l?.url || l?.href || '#'
          };
        })
      : (((navDoc as any).data as Record<string, unknown>)?.links);

    return NextResponse.json({
      travelling: {
        eyebrow: (travellingDoc as any).eyebrow,
        title: (travellingDoc as any).title,
        lead: (travellingDoc as any).lead,
        ...(((travellingDoc as any).data as Record<string, unknown>) || {}),
        focus: (travellingDoc as any).focus || ((travellingDoc as any).data as any)?.focus
      },
      navigation: {
        ...(((navDoc as any).data as Record<string, unknown>) || {}),
        links: navLinks
      },
      navItems: navLinks,
      updatedAt: new Date().toISOString()
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
