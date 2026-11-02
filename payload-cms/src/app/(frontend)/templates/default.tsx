import React from 'react'

import { PageDoc, RenderLayout, Section } from './shared'

/**
 * Generic page template. It exists so a page created in the CMS always has a
 * real public page, even when it uses no template of its own. It renders the
 * page's own title, eyebrow and lead plus any content blocks in the standard
 * section styles.
 */
export default function DefaultTemplate({ page }: { page: PageDoc }) {
  return (
    <main>
      <Section
        eyebrow={page.eyebrow || undefined}
        title={page.title}
        lead={page.lead || undefined}
      >
        <RenderLayout page={page} />
      </Section>
    </main>
  )
}
