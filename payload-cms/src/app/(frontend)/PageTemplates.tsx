import type { RequiredDataFromCollectionSlug } from 'payload'
import Link from 'next/link'
import React from 'react'

import { RenderBlocks } from '@/blocks/RenderBlocks'
import { RenderHero } from '@/heros/RenderHero'
import { getSafePayload } from '@/utilities/getSafePayload'

type PageDoc = RequiredDataFromCollectionSlug<'pages'>

type ProjectDoc = {
  title?: string
  role?: string
  summary?: string
  tags?: Array<{ tag?: string }>
}

type ExperienceDoc = {
  year?: string
  title?: string
  organization?: string
  summary?: string
  highlights?: Array<{ highlight?: string }>
}

async function loadCollections() {
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

function Section({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: string; children?: React.ReactNode }) {
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

function SimpleCards({ items }: { items: Array<{ title?: string; kicker?: string; text?: string }> }) {
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

function HeroButtons({ primaryButton, secondaryButton }: { primaryButton?: { label?: string; href?: string }; secondaryButton?: { label?: string; href?: string } }) {
  return (
    <div className="flex flex-wrap gap-3">
      {primaryButton?.label && primaryButton?.href && (
        <Link className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90" href={primaryButton.href}>
          {primaryButton.label}
        </Link>
      )}
      {secondaryButton?.label && secondaryButton?.href && (
        <Link className="inline-flex items-center justify-center rounded-full border border-border bg-background px-5 py-3 text-sm font-medium transition-colors hover:bg-secondary" href={secondaryButton.href}>
          {secondaryButton.label}
        </Link>
      )}
    </div>
  )
}

function RenderLayout({ page }: { page: PageDoc }) {
  if (Array.isArray(page.layout) && page.layout.length > 0) {
    return <RenderBlocks blocks={page.layout as any} />
  }

  return null
}

function HomeTemplate({ page }: { page: PageDoc }) {
  const data = (page as any).data || {}
  const focus = (page as any).focus || {}

  return (
    <>
      <RenderHero {...page.hero} />
      <Section
        eyebrow={page.eyebrow || 'Home'}
        title={page.title || 'Building dependable systems with operational discipline.'}
        lead={page.lead || 'I design and ship resilient developer experiences, automation layers, and production-ready interfaces.'}
      >
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-border bg-card p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Current focus</p>
            <h3 className="mt-3 text-2xl font-medium">{focus.title || 'Building personal infrastructure'}</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(focus.items || []).map((item: any) => (
                <div key={`${item.label}-${item.value}`} className="rounded-2xl border border-border bg-background p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-sm leading-6">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-border bg-card p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Highlights</p>
            <div className="mt-4 grid gap-3">
              {(data.metrics || []).map((metric: any) => (
                <div key={`${metric.value}-${metric.label}`} className="rounded-2xl border border-border bg-background p-4">
                  <p className="text-2xl font-semibold">{metric.value}</p>
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-8">
          <HeroButtons primaryButton={data.primaryButton} secondaryButton={data.secondaryButton} />
        </div>
      </Section>
      <RenderLayout page={page} />
    </>
  )
}

function ContactTemplate({ page }: { page: PageDoc }) {
  const links = ((page as any).data?.links || []) as Array<{ label?: string; href?: string }>
  return (
    <>
      <Section eyebrow={page.eyebrow || 'Contact'} title={page.title || 'Open to platform, DevOps, and development work.'} lead={page.lead || 'I am available for contract and full-time work.'}>
        <div className="grid gap-4 md:grid-cols-3">
          {links.map((link) => (
            <a key={link.href} className="rounded-3xl border border-border bg-card p-6 transition-colors hover:bg-secondary" href={link.href}>
              <p className="text-sm text-muted-foreground">Contact</p>
              <p className="mt-2 text-lg font-medium">{link.label}</p>
            </a>
          ))}
        </div>
      </Section>
      <RenderLayout page={page} />
    </>
  )
}

function TravellingTemplate({ page }: { page: PageDoc }) {
  const data = (page as any).data || {}
  const cards = Array.isArray(data.cards) ? data.cards : []

  return (
    <>
      <Section eyebrow={page.eyebrow || 'Travelling'} title={page.title || 'Travelling round Southeast Asia in 2016.'} lead={page.lead || 'A visual archive from the 2016 journey.'}>
        <SimpleCards items={cards} />
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-border bg-card p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Project summary</p>
            <p className="mt-3 text-base leading-7 text-muted-foreground">{data.summaryLead || 'The travelling project is a separate gallery stack built around the photos from the trip.'}</p>
          </div>
          <div className="rounded-3xl border border-border bg-card p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Architecture</p>
            <p className="mt-3 text-base leading-7 text-muted-foreground">{data.architecture?.title || 'Architecture for travelling.rossmoney.me.'}</p>
          </div>
        </div>
      </Section>
      <RenderLayout page={page} />
    </>
  )
}

function ArchitectureTemplate({ page }: { page: PageDoc }) {
  const data = (page as any).data || {}
  return (
    <Section eyebrow={page.eyebrow || data.sectionEyebrow || 'Architecture'} title={page.title || data.sectionTitle || 'Data streamed from the host Go service.'} lead={page.lead || data.sectionLead || 'A live snapshot of the deployment shape.'}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {['Docker daemon', 'Host telemetry', 'Service topology', 'Live APIs'].map((item) => (
          <div key={item} className="rounded-3xl border border-border bg-card p-6">
            <p className="text-sm font-medium">{item}</p>
          </div>
        ))}
      </div>
      <RenderLayout page={page} />
    </Section>
  )
}

function CommitsTemplate({ page }: { page: PageDoc }) {
  const data = (page as any).data || {}
  return (
    <Section eyebrow={page.eyebrow || 'Commits'} title={page.title || 'Recent GitHub commits.'} lead={page.lead || `Repository: ${data.repository || 'tekkifox/rossmoney_me'}` }>
      <div className="rounded-3xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">GitHub repo</p>
        <p className="mt-1 text-lg font-medium">{data.repository || 'tekkifox/rossmoney_me'}</p>
        <p className="mt-2 text-sm text-muted-foreground">Branch: {data.branch || 'main'}</p>
      </div>
      <RenderLayout page={page} />
    </Section>
  )
}

function WorkTemplate({ page, projects }: { page: PageDoc; projects: ProjectDoc[] }) {
  return (
    <Section eyebrow={page.eyebrow || 'Selected work'} title={page.title || 'Real roles and projects from my CV.'} lead={page.lead || 'A curated summary of roles, responsibilities, and projects.'}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <article key={project.title} className="rounded-3xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">{project.role}</p>
            <h3 className="mt-2 text-lg font-medium">{project.title}</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{project.summary}</p>
          </article>
        ))}
      </div>
      <RenderLayout page={page} />
    </Section>
  )
}

function ExperienceTemplate({ page, experience }: { page: PageDoc; experience: ExperienceDoc[] }) {
  return (
    <Section eyebrow={page.eyebrow || 'Experience'} title={page.title || 'Recent delivery history.'} lead={page.lead || 'A short narrative of the work I have done recently.'}>
      <div className="space-y-4">
        {experience.map((entry) => (
          <article key={`${entry.year}-${entry.title}`} className="rounded-3xl border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{entry.year}</p>
            <h3 className="mt-2 text-lg font-medium">{entry.title}</h3>
            <p className="text-sm text-muted-foreground">{entry.organization}</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{entry.summary}</p>
          </article>
        ))}
      </div>
      <RenderLayout page={page} />
    </Section>
  )
}

function NavigationTemplate({ page }: { page: PageDoc }) {
  const links = ((page as any).data?.links || []) as Array<{ label?: string; href?: string }>
  return (
    <Section eyebrow={page.eyebrow || 'Navigation'} title={page.title || 'Site navigation links.'} lead={page.lead || 'Structured links used by the CMS-driven header and footer.'}>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <a key={`${link.label}-${link.href}`} className="rounded-3xl border border-border bg-card p-6 hover:bg-secondary" href={link.href}>
            {link.label}
          </a>
        ))}
      </div>
      <RenderLayout page={page} />
    </Section>
  )
}

export async function PageTemplates({ page }: { page: PageDoc }) {
  const collections = page.slug === 'work' || page.slug === 'experience-page' ? await loadCollections() : null

  switch (page.slug) {
    case 'home':
      return <HomeTemplate page={page} />
    case 'contact':
      return <ContactTemplate page={page} />
    case 'travelling':
      return <TravellingTemplate page={page} />
    case 'architecture':
      return <ArchitectureTemplate page={page} />
    case 'commits':
      return <CommitsTemplate page={page} />
    case 'work':
      return <WorkTemplate page={page} projects={collections?.projects || []} />
    case 'experience-page':
      return <ExperienceTemplate page={page} experience={collections?.experience || []} />
    case 'navigation':
      return <NavigationTemplate page={page} />
    default:
      return (
        <>
          <RenderHero {...page.hero} />
          <RenderLayout page={page} />
        </>
      )
  }
}
