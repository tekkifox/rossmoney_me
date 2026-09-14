import { ExperienceDoc, PageDoc, RenderLayout, Section } from './shared'

export default function ExperiencePageTemplate({ page, experience }: { page: PageDoc; experience: ExperienceDoc[] }) {
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
