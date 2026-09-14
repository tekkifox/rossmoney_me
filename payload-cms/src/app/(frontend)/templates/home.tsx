import Link from 'next/link'

import { RenderHero } from '@/heros/RenderHero'

import { PageDoc, RenderLayout, Section } from './shared'

export default function HomeTemplate({ page }: { page: PageDoc }) {
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
        <div className="mt-8 flex flex-wrap gap-3">
          {data.primaryButton?.label && data.primaryButton?.href && (
            <Link className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90" href={data.primaryButton.href}>
              {data.primaryButton.label}
            </Link>
          )}
          {data.secondaryButton?.label && data.secondaryButton?.href && (
            <Link className="inline-flex items-center justify-center rounded-full border border-border bg-background px-5 py-3 text-sm font-medium transition-colors hover:bg-secondary" href={data.secondaryButton.href}>
              {data.secondaryButton.label}
            </Link>
          )}
        </div>
      </Section>
      <RenderLayout page={page} />
    </>
  )
}
