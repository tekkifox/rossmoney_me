import { PageDoc, RenderLayout, Section } from './shared'

export default function ContactTemplate({ page }: { page: PageDoc }) {
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
