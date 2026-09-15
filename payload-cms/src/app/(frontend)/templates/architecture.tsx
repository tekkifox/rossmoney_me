import { PageDoc, RenderLayout, Section } from './shared'

export default function ArchitectureTemplate({ page }: { page: PageDoc }) {
  const data = (page as any).data || {}
  return (
    <Section eyebrow={page.eyebrow || data.sectionEyebrow || 'Architecture'} title={page.title || data.sectionTitle || 'Live architecture snapshot'} lead={page.lead || data.sectionLead || 'A live snapshot of the deployment shape.'}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {['Service topology', 'Image inventory', 'Live APIs', 'Deployment summary'].map((item) => (
          <div key={item} className="rounded-3xl border border-border bg-card p-6">
            <p className="text-sm font-medium">{item}</p>
          </div>
        ))}
      </div>
      <RenderLayout page={page} />
    </Section>
  )
}
