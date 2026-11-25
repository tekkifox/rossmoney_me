import React from 'react'
import { PageDoc, RenderLayout } from './shared'
import CVViewer from '@/components/CVViewer'

export default function CVTemplate({ page }: { page: PageDoc }) {
  return (
    <main id="main-content" tabIndex={-1}>
      <section className="section container">
        <div className="section-heading">
          <h1 className="sr-only">Ross Money — Curriculum Vitae</h1>
          <p className="eyebrow">Curriculum Vitae</p>
          {page.lead ? <p className="lead">{page.lead}</p> : null}
        </div>
        <CVViewer cvFile={page.cvFile} />
      </section>
      <RenderLayout page={page} />
    </main>
  )
}
