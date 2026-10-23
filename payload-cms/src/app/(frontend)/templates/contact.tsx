import { PageDoc, RenderLayout, Section } from './shared'
import { FormBlock } from '@/blocks/Form/Component'
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function ContactTemplate({ page }: { page: PageDoc }) {
  const links = ((page as any).data?.links || []) as Array<{ label?: string; href?: string }>
  
  let form = null
  try {
    const payload = await getPayload({ config })
    const forms = await payload.find({
      collection: 'forms',
      where: {
        title: {
          equals: 'Contact Form',
        },
      },
      limit: 1,
    })
    if (forms.docs.length > 0) {
      form = forms.docs[0]
    }
  } catch (e) {
    // ignore
  }

  return (
    <>
      <Section eyebrow={page.eyebrow || 'Contact'} title={page.title || 'Open to platform, DevOps, and development work.'} lead={page.lead || 'I am available for contract and full-time work.'}>
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          {links.map((link) => (
            <a key={link.href} className="rounded-3xl border border-border bg-card p-6 transition-colors hover:bg-secondary" href={link.href}>
              <p className="text-sm text-muted-foreground">Contact</p>
              <p className="mt-2 text-lg font-medium">{link.label}</p>
            </a>
          ))}
        </div>
        {form && (
          <div className="rounded-3xl border border-border bg-card p-6 md:p-8">
            <FormBlock
              enableIntro={true}
              form={form as any}
              blockType="formBlock"
            />
          </div>
        )}
      </Section>
      <RenderLayout page={page} />
    </>
  )
}
