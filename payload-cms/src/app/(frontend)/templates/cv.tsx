import React from 'react'
import { PageDoc, RenderLayout } from './shared'
import CVViewer from '@/components/CVViewer'

export default function CVTemplate({ page }: { page: PageDoc }) {
  return (
    <main>
      <section className="section container">
        <div className="section-heading">
          <p className="eyebrow">Curriculum Vitae</p>
          <h2>Curriculum Vitae</h2>
        </div>
        <CVViewer />
      </section>
      <RenderLayout page={page} />
    </main>
  )
}
