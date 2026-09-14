import { PageDoc, RenderLayout, Section } from './shared'

export default function CommitsTemplate({ page }: { page: PageDoc }) {
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
