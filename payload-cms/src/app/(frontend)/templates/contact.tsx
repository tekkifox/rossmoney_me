import { FormBlock } from '@/blocks/Form/Component'
import { getContactForm } from '@/utilities/getContactForm'

import { PageDoc, RenderLayout, Section } from './shared'

export default async function ContactTemplate({ page }: { page: PageDoc }) {
  const links = ((page as any).data?.links || []) as Array<{ label?: string; href?: string }>
  const contactForm = await getContactForm()
  const emailLink = links.find((link) => link.href?.startsWith('mailto:'))?.href

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

      <section id="contact-form" className="container space-y-8 py-12 sm:py-16">
        <div className="section-heading max-w-3xl">
          <p className="eyebrow">Get in touch</p>
          <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">Send a message</h2>
          <p className="lead">Tell me a little about the work and I will get back to you.</p>
        </div>

        {contactForm ? (
          <div className="rounded-3xl border border-border bg-card p-6 md:p-8">
            <FormBlock form={contactForm as any} enableIntro={true} />
          </div>
        ) : (
          <div className="rounded-3xl border border-border bg-card p-6">
            <p>The contact form is unavailable right now.</p>
            {emailLink && (
              <p className="mt-2">
                You can email me directly at <a className="underline" href={emailLink}>{emailLink.replace('mailto:', '')}</a>.
              </p>
            )}
          </div>
        )}
      </section>

      <RenderLayout page={page} />
    </>
  )
}
