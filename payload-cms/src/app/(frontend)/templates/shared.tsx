import type { RequiredDataFromCollectionSlug } from 'payload'
import React from 'react'

import { RenderBlocks } from '@/blocks/RenderBlocks'
import { getSafePayload } from '@/utilities/getSafePayload'

export type PageDoc = RequiredDataFromCollectionSlug<'pages'>

export type ProjectDoc = {
  title?: string
  role?: string
  summary?: string
}

export type ExperienceDoc = {
  year?: string
  title?: string
  organization?: string
  summary?: string
}

export async function loadCollections() {
  const payload = await getSafePayload()
  const pClient = payload as any

  const [projects, experience] = await Promise.all([
    pClient.find({ collection: 'projects', limit: 100, sort: 'order' }),
    pClient.find({ collection: 'experience', limit: 100, sort: 'order' }),
  ])

  return {
    projects: projects.docs as ProjectDoc[],
    experience: experience.docs as ExperienceDoc[],
  }
}

export function Section({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <section className="container space-y-8 py-12 sm:py-16">
      <div className="max-w-3xl space-y-3">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">{eyebrow}</p>}
        <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h2>
        {lead && <p className="text-base leading-7 text-muted-foreground sm:text-lg">{lead}</p>}
      </div>
      {children}
    </section>
  )
}

export function SimpleCards({ items }: { items: Array<{ title?: string; kicker?: string; text?: string }> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => (
        <article key={`${item.title || item.kicker || index}`} className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          {item.kicker && <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">{item.kicker}</p>}
          {item.title && <h3 className="mt-2 text-lg font-medium">{item.title}</h3>}
          {item.text && <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.text}</p>}
        </article>
      ))}
    </div>
  )
}

export function RenderLayout({ page }: { page: PageDoc }) {
  if (Array.isArray(page.layout) && page.layout.length > 0) {
    return <RenderBlocks blocks={page.layout as any} />
  }

  return null
}
