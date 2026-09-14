import { PageDoc, ProjectDoc, RenderLayout, Section } from './shared'

export default function WorkTemplate({ page, projects }: { page: PageDoc; projects: ProjectDoc[] }) {
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
