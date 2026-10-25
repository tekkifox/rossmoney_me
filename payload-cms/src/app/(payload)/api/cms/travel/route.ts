import { NextResponse } from 'next/server'

import { assembleSite } from '@/utilities/assembleSite'
import { travelling as travellingSeed } from '@/endpoints/seed/travelling-page'
import { asRecord, asString } from '@/utilities/json'

async function fetchRecentCommits() {
  return fetch('https://api.github.com/repos/tekkifox/image-mosaic/commits?per_page=5&sha=main', {
    headers: {
      Accept: 'application/vnd.github+json'
    },
    cache: 'no-store'
  }).then(async (response) => {
    if (!response.ok) {
      return []
    }
    const data: unknown = await response.json().catch(() => [])
    return Array.isArray(data)
      ? data.map((commit) => {
          const record = asRecord(commit)
          const details = asRecord(record.commit)
          return {
            sha: asString(record.sha),
            message: asString(details.message)?.split('\n')[0] || 'No commit message'
          }
        })
      : []
  }).catch(() => [])
}

export async function GET() {
  try {
    const site = await assembleSite()
    const contactDoc = site.contact
    const travellingDoc = asRecord(site.travelling ?? travellingSeed)
    const navLinks = site.navItems ?? site.navigation?.links ?? []
    const commits = await fetchRecentCommits()

    // prefer assembled navLinks from site assembly
    const navLinksFinal = Array.isArray(navLinks) ? navLinks : []

    return NextResponse.json({
    travelling: {
      eyebrow: asString(travellingDoc.eyebrow),
      title: asString(travellingDoc.title),
      lead: asString(travellingDoc.lead),
      ...asRecord(travellingDoc.data),
      github: {
        owner: 'tekkifox',
        repo: 'image-mosaic',
        branch: 'main',
      },
      focus: travellingDoc.focus || asRecord(travellingDoc.data).focus,
    },
    navigation: {
      ...asRecord(site.navigation?.data),
      links: navLinksFinal,
    },
    contact: {
      eyebrow: asString(contactDoc.eyebrow),
      title: asString(contactDoc.title),
      lead: asString(contactDoc.lead),
      ...asRecord(contactDoc.data),
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
