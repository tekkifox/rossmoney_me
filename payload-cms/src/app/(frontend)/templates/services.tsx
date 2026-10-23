import React from 'react'

import { PageDoc, PageMeta, RenderLayout, Section } from './shared'

type ServiceRate = {
  min?: number
  max?: number
  currency?: string
  unit?: string
}

type Service = {
  slug?: string
  name?: string
  badge?: string
  summary?: string
  focus?: string
  includes?: string[]
  detail?: string
  bestFor?: string
  rate?: ServiceRate
}

function currencySymbol(currency?: string) {
  if (currency === 'GBP') return '£'
  if (currency === 'USD') return '$'
  if (currency === 'EUR') return '€'
  return currency ? `${currency} ` : ''
}

function formatMoney(amount: number, currency?: string) {
  return `${currencySymbol(currency)}${amount.toLocaleString('en-GB')}`
}

function formatRate(rate?: ServiceRate) {
  if (!rate || typeof rate.min !== 'number' || typeof rate.max !== 'number') return ''
  return `${formatMoney(rate.min, rate.currency)}–${formatMoney(rate.max, rate.currency)} / ${rate.unit || 'day'}`
}

function rateBounds(services: Service[]) {
  const values = services
    .flatMap((service) => [service.rate?.min, service.rate?.max])
    .filter((value): value is number => typeof value === 'number')

  if (values.length === 0) return ''
  const currency = services.find((service) => service.rate)?.rate?.currency
  return `${formatMoney(Math.min(...values), currency)}–${formatMoney(Math.max(...values), currency)}`
}

function ServiceCard({
  service,
  detailLabel,
  rateLabel,
}: {
  service: Service
  detailLabel?: string
  rateLabel?: string
}) {
  return (
    <article
      className="flex h-full flex-col rounded-3xl border border-border bg-card p-6 shadow-sm"
      id={service.slug ? `service-${service.slug}` : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {service.badge && (
          <span className="inline-flex items-center rounded-full border border-border bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {service.badge}
          </span>
        )}
        <span className="text-xs font-medium text-muted-foreground">{rateLabel}</span>
      </div>

      {service.name && <h3 className="mt-4 text-xl font-medium tracking-tight">{service.name}</h3>}
      {service.summary && (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{service.summary}</p>
      )}

      <p className="mt-5 text-2xl font-semibold tracking-tight">
        {formatRate(service.rate)}
      </p>

      {Array.isArray(service.includes) && service.includes.length > 0 && (
        <ul className="mt-5 space-y-2 text-sm leading-6">
          {service.includes.map((item) => (
            <li className="flex gap-3" key={item}>
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}

      {service.slug && detailLabel && (
        <a
          className="mt-auto pt-6 text-sm font-medium text-primary underline-offset-4 hover:underline"
          href={`#detail-${service.slug}`}
        >
          {detailLabel}
        </a>
      )}
    </article>
  )
}

export default function ServicesTemplate({ page }: { page: PageDoc }) {
  const data = ((page as any).data || {}) as any
  const services = (Array.isArray(data.services) ? data.services : []) as Service[]
  const heroStats = data.heroStats || {}
  const pricingTable = data.pricingTable || {}
  const accordion = data.accordion || {}
  const engagement = data.engagement || {}
  const cta = data.cta || {}
  const pricingBasis = data.pricingBasis || {}
  const secondaryButton = data.secondaryButton || {}
  const range = rateBounds(services)

  return (
    <main className="services-page">
      <PageMeta page={page} />

      <section className="hero container">
        <div className="hero-copy">
          {page.eyebrow && <p className="eyebrow">{page.eyebrow}</p>}
          {page.title && <h1>{page.title}</h1>}
          {page.lead && <p className="lead">{page.lead}</p>}

          <div className="hero-actions">
            {cta.label && cta.href && (
              <a className="btn btn-primary" href={cta.href}>
                {cta.label}
              </a>
            )}
            {secondaryButton.label && secondaryButton.href && (
              <a className="btn btn-secondary" href={secondaryButton.href}>
                {secondaryButton.label}
              </a>
            )}
          </div>

          <div className="hero-metrics" aria-label={heroStats.ariaLabel}>
            <article className="metric">
              <span className="metric-value">{services.length}</span>
              <span className="metric-label">{heroStats.servicesLabel}</span>
            </article>
            <article className="metric">
              <span className="metric-value">{range}</span>
              <span className="metric-label">{heroStats.rangeLabel}</span>
            </article>
            <article className="metric">
              <span className="metric-value">{heroStats.reviewed}</span>
              <span className="metric-label">{heroStats.reviewLabel}</span>
            </article>
          </div>
        </div>
      </section>

      <div id="services">
        <Section
          className="services-section"
          eyebrow={data.servicesSection?.eyebrow}
          title={data.servicesSection?.title || ''}
          lead={data.servicesSection?.lead}
        >
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {services.map((service, index) => (
              <ServiceCard
                detailLabel={data.servicesSection?.detailLabel}
                key={service.slug || service.name || index}
                rateLabel={pricingTable.rateColumn}
                service={service}
              />
            ))}
          </div>
        </Section>
      </div>

      <Section className="services-section" eyebrow={pricingTable.eyebrow} title={pricingTable.title || ''} lead={pricingTable.lead}>
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <caption className="sr-only">{pricingTable.caption}</caption>
              <thead className="bg-primary text-primary-foreground">
                <tr>
                  <th className="px-6 py-4 font-medium" scope="col">
                    {pricingTable.serviceColumn}
                  </th>
                  <th className="px-6 py-4 font-medium" scope="col">
                    {pricingTable.focusColumn}
                  </th>
                  <th className="px-6 py-4 text-right font-medium" scope="col">
                    {pricingTable.rateColumn}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {services.map((service, index) => (
                  <tr className="even:bg-secondary/60" key={service.slug || service.name || index}>
                    <th className="px-6 py-4 font-medium" scope="row">
                      {service.name}
                    </th>
                    <td className="px-6 py-4 text-muted-foreground">{service.focus}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-right font-semibold">
                      {formatRate(service.rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {pricingBasis.summary && (
          <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
            <p>{pricingBasis.summary}</p>
            {Array.isArray(pricingBasis.sources) && pricingBasis.sources.length > 0 && (
              <details className="rounded-2xl border border-border bg-card px-5 py-4">
                <summary className="cursor-pointer font-medium text-foreground">
                  {pricingBasis.sourcesLabel}
                </summary>
                <ul className="mt-3 space-y-2">
                  {pricingBasis.sources.map((source: { label?: string; url?: string }) => (
                    <li key={source.url}>
                      <a
                        className="text-primary underline-offset-4 hover:underline"
                        href={source.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {source.label || source.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Section>

      <Section className="services-section" eyebrow={accordion.eyebrow} title={accordion.title || ''} lead={accordion.lead}>
        <div className="space-y-3">
          {services.map((service, index) => (
            <details
              className="group rounded-2xl border border-border bg-card px-5 py-4 shadow-sm"
              id={service.slug ? `detail-${service.slug}` : undefined}
              key={service.slug || service.name || index}
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <span className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold">{service.name}</span>
                  {service.badge && (
                    <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {service.badge}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3 text-sm text-muted-foreground">
                  {formatRate(service.rate)}
                  <span aria-hidden className="transition-transform group-open:rotate-45">
                    +
                  </span>
                </span>
              </summary>

              <div className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
                {service.detail && <p>{service.detail}</p>}
                {service.bestFor && accordion.bestForLabel && (
                  <p className="mt-3">
                    <span className="font-medium text-foreground">{accordion.bestForLabel}: </span>
                    {service.bestFor}
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      </Section>

      <Section className="services-section" eyebrow={engagement.eyebrow} title={engagement.title || ''} lead={engagement.lead}>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.isArray(engagement.items) &&
            engagement.items.map((item: { label?: string; value?: string }, index: number) => (
              <article
                className="rounded-3xl border border-border bg-card p-6 shadow-sm"
                key={`${item.label || 'engagement'}-${index}`}
              >
                {item.label && (
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    {item.label}
                  </p>
                )}
                {item.value && <p className="mt-2 text-sm leading-6">{item.value}</p>}
              </article>
            ))}
        </div>
      </Section>

      {cta.title && (
        <section className="section container services-section">
          <div className="rounded-3xl border border-border bg-primary p-8 text-primary-foreground shadow-sm sm:p-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                {cta.eyebrow && (
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary-foreground/70">
                    {cta.eyebrow}
                  </p>
                )}
                <h2 className="mt-3 text-3xl font-medium tracking-tight">{cta.title}</h2>
                {cta.lead && (
                  <p className="mt-3 text-sm leading-6 text-primary-foreground/80">{cta.lead}</p>
                )}
              </div>
              {cta.label && cta.href && (
                <a className="btn btn-secondary shrink-0" href={cta.href}>
                  {cta.label}
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      <RenderLayout page={page} />
    </main>
  )
}
