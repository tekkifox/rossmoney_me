import { PageDoc, RenderLayout, Section, readPageData, readString } from './shared'

export default function ArchitectureTemplate({ page }: { page: PageDoc }) {
  const data = readPageData(page)
  return (
    <Section eyebrow={page.eyebrow || readString(data.sectionEyebrow) || 'Architecture'} title={page.title || readString(data.sectionTitle) || 'Live architecture snapshot'} lead={page.lead || readString(data.sectionLead) || 'A live snapshot of the deployment shape.'}>
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
