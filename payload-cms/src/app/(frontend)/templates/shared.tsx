import type { RequiredDataFromCollectionSlug } from 'payload'
import React from 'react'

import { RenderBlocks } from '@/blocks/RenderBlocks'
import { browserArchitectureApi } from '@/utilities/architectureURL'

export type PageDoc = RequiredDataFromCollectionSlug<'pages'>

export type UnknownRecord = { [key: string]: unknown }

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

export type MetricItem = {
  value?: string | number
  label?: string | number
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function readText(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

export function readPageData(page: PageDoc): UnknownRecord {
  return isRecord(page.data) ? page.data : {}
}

export function readPageContact(page: PageDoc): unknown {
  return 'contact' in page ? page.contact : null
}

export function readStringFields<K extends string>(
  value: unknown,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const record = isRecord(value) ? value : {}
  const fields: Partial<Record<K, string>> = {}
  for (const key of keys) {
    const field = readString(record[key])
    if (field !== undefined) fields[key] = field
  }
  return fields
}

export function readLinks(value: unknown): Array<{ label?: string; href?: string }> {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const record = isRecord(entry) ? entry : {}
    return { label: readString(record.label), href: readString(record.href) }
  })
}

export function readMetrics(value: unknown): MetricItem[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const record = isRecord(entry) ? entry : {}
    return { value: readText(record.value), label: readText(record.label) }
  })
}

export function readProjects(value: unknown): ProjectDoc[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const record = isRecord(entry) ? entry : {}
    return {
      title: readString(record.title),
      role: readString(record.role),
      summary: readString(record.summary),
    }
  })
}

export function readExperience(value: unknown): ExperienceDoc[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const record = isRecord(entry) ? entry : {}
    return {
      year: readString(record.year),
      title: readString(record.title),
      organization: readString(record.organization),
      summary: readString(record.summary),
    }
  })
}

export function Section({ eyebrow, title, lead, children, className }: { eyebrow?: string; title: string; lead?: string; children?: React.ReactNode; className?: string }) {
  return (
    <section className={`container space-y-8 py-12 sm:py-16${className ? ` ${className}` : ''}`}>
      <div className="section-heading max-w-3xl">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h2>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children}
    </section>
  )
}

export function ContactPanel({ contact }: { contact?: unknown }) {
  const c = isRecord(contact) ? contact : {}
  const links = readLinks(c.links)
  const eyebrow = readText(c.eyebrow)
  const title = readText(c.title)
  const lead = readText(c.lead)

  return (
    <section className="section container contact-section" id="contact">
      <div className="card contact-card">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          {title && <h2>{title}</h2>}
          {lead && <p className="lead">{lead}</p>}
        </div>

        <div className="contact-links">
          {links.map((l, i) => (
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
    return <RenderBlocks blocks={page.layout} />
  }

  return null
}

import Head from 'next/head'

export function PageMeta({ page, architectureApi }: { page: PageDoc; architectureApi?: string }) {
  const data = readPageData(page)
  const archview = page.archviewUrl || readString(data.archviewUrl) || process.env.ARCHVIEW_URL || process.env.ARCHVIEW_HOST || process.env.ARCHVIEW || ''
  const api = architectureApi || browserArchitectureApi(archview)
  return (
    <Head>
      <meta name="architecture-api" content={api} />
    </Head>
  )
}
