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
      <div className="section-heading max-w-3xl">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h2>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children}
    </section>
  )
}

export function ContactPanel({ contact }: { contact?: any }) {
  const c = contact || {}
  const links = Array.isArray(c.links) ? c.links : []

  return (
    <section className="section container contact-section" id="contact">
      <div className="card contact-card">
        <div>
          {c.eyebrow && <p className="eyebrow">{c.eyebrow}</p>}
          {c.title && <h2>{c.title}</h2>}
          {c.lead && <p className="lead">{c.lead}</p>}
        </div>

        <div className="contact-links">
          {links.map((l: any, i: number) => (
            <a key={i} href={l?.href || '#'} className="text-muted small" rel="noreferrer">{l?.label || l?.href || 'Contact'}</a>
          ))}
        </div>
      </div>
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

import Head from 'next/head'

export function PageMeta({ page }: { page: PageDoc }) {
  const archview = (page as any).archviewUrl || (page as any).data?.archviewUrl || process.env.ARCHVIEW_URL || process.env.ARCHVIEW_HOST || process.env.ARCHVIEW || ''
  const base = archview ? String(archview).replace(/\/$/, '') : ''
  const api = base ? `${base}/api/architecture` : '/api/architecture'
  return (
    <Head>
      <meta name="architecture-api" content={api} />
    </Head>
  )
}
