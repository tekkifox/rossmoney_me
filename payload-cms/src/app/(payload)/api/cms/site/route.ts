import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import config from '@payload-config';

export async function GET() {
  try {
    const payload = await getPayload({ config });
    const pClient = payload as any;
    const pages = await pClient.find({ collection: 'pages', limit: 100 });
    const projects = await pClient.find({ collection: 'projects', limit: 100, sort: 'order' });
    const experience = await pClient.find({ collection: 'experience', limit: 100, sort: 'order' });

    const homeDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'home') || {};
    const contactDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'contact') || {};
    const archDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'architecture') || {};
    const commitsDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'commits') || {};
    const navDoc = pages.docs.find((p: Record<string, unknown>) => p.slug === 'navigation') || {};

    return NextResponse.json({
      home: {
        eyebrow: (homeDoc as any).eyebrow,
        title: (homeDoc as any).title,
        lead: (homeDoc as any).lead,
        ...(((homeDoc as any).data as Record<string, unknown>) || {})
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
        ...(((navDoc as any).data as Record<string, unknown>) || {})
      },
      projects: projects.docs,
      experience: experience.docs,
      updatedAt: new Date().toISOString()
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
