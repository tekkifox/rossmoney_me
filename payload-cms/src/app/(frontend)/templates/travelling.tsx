import { PageDoc, RenderLayout, Section, SimpleCards } from './shared'

export default function TravellingTemplate({ page }: { page: PageDoc }) {
  const data = (page as any).data || {}
  const cards = Array.isArray(data.cards) ? data.cards : []

  return (
    <>
      <Section eyebrow={page.eyebrow || 'Travelling'} title={page.title || 'Travelling round Southeast Asia in 2016.'} lead={page.lead || 'A visual archive from the 2016 journey.'}>
        <SimpleCards items={cards} />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {(data.metrics || []).map((metric: any) => (
            <div key={`${metric.value}-${metric.label}`} className="rounded-3xl border border-border bg-card p-6">
              <p className="text-2xl font-semibold">{metric.value}</p>
              <p className="mt-2 text-sm text-muted-foreground">{metric.label}</p>
            </div>
          ))}
        </div>
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
