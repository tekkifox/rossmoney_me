import { NextResponse } from 'next/server'
import { assembleSite } from '@/utilities/assembleSite'
import { travelling as travellingSeed } from '@/endpoints/seed/travelling-page'

export async function GET() {
  try {
    const site = await assembleSite()
    const contactDoc = site.contact || {}
    const travellingDoc = site.travelling || (travellingSeed as any) || {}
    const navLinks = site.navItems || (site.navigation && site.navigation.links) || []
    const commits = await fetch('https://api.github.com/repos/tekkifox/image-mosaic/commits?per_page=5&sha=main', {
      headers: {
        Accept: 'application/vnd.github+json'
      },
      cache: 'no-store'
    }).then(async (response) => {
      if (!response.ok) {
        return [];
      }
      const data = await response.json().catch(() => []);
      return Array.isArray(data)
        ? data.map((commit: any) => ({
            sha: commit?.sha,
            message: commit?.commit?.message?.split('\n')[0] || 'No commit message'
          }))
        : [];
    }).catch(() => []);

    // prefer assembled navLinks from site assembly
    const navLinksFinal = Array.isArray(navLinks) ? navLinks : []

    return NextResponse.json({
    travelling: {
      eyebrow: (travellingDoc as any).eyebrow,
      title: (travellingDoc as any).title,
      lead: (travellingDoc as any).lead,
      ...(((travellingDoc as any).data as Record<string, unknown>) || {}),
      github: {
        owner: 'tekkifox',
        repo: 'image-mosaic',
        branch: 'main',
      },
      focus: (travellingDoc as any).focus || ((travellingDoc as any).data as any)?.focus,
    },
    navigation: {
      ...(((site.navigation as any)?.data as Record<string, unknown>) || {}),
      links: navLinksFinal,
    },
    contact: {
      eyebrow: (contactDoc as any).eyebrow,
      title: (contactDoc as any).title,
      lead: (contactDoc as any).lead,
      ...(((contactDoc as any).data as Record<string, unknown>) || {}),
    },
      commits: {
        items: commits,
        repo: 'tekkifox/image-mosaic',
        branch: 'main'
      },
      navItems: navLinks,
      updatedAt: new Date().toISOString()
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
