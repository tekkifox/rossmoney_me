import { PageDoc, RenderLayout, Section } from './shared'

export default function NavigationTemplate({ page }: { page: PageDoc }) {
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
