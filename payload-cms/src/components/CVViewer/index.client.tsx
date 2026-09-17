"use client"
import React, { useEffect, useRef, useState } from 'react'

export default function CVViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function renderDoc() {
      try {
        // Try to fetch CV file from CMS pages api (expecting a 'cv' page with cvFile relation)
        let blob: Blob | null = null
        try {
          const pageRes = await fetch('/api/pages?where[slug][equals]=cv&depth=2')
          if (pageRes.ok) {
            const pageJson = await pageRes.json()
            const doc = Array.isArray(pageJson?.docs) && pageJson.docs.length ? pageJson.docs[0] : null
            const media = doc?.cvFile || null
            let url = null
            if (media) {
              url = media.url || (media.filename ? `/media/${media.filename}` : null)
            }
            if (url) {
              const r = await fetch(url)
              if (r.ok) blob = await r.blob()
            }
          }
        } catch (e) {
          // fall through to static fetch
        }

        if (!blob) {
          // fallback to public/media/rossmoney_cv.docx
          const res = await fetch('/media/rossmoney_cv.docx')
          if (!res.ok) throw new Error(`Failed to fetch CV (${res.status})`)
          blob = await res.blob()
        }

        const arrayBuffer = await blob.arrayBuffer()
        // dynamic import to avoid build-time dependency problems
        const mammoth = await import('mammoth')
        // convert DOCX to HTML
        const result = await (mammoth as any).convertToHtml({ arrayBuffer })
        const html = result && result.value ? result.value : ''

        const container = containerRef.current
        if (!container) return
        container.innerHTML = html
        // Ensure a small wrapper class remains for optional styling
        container.classList.add('docx')
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('CV render failed', err)
        if (!cancelled) setError(String((err as any)?.message ?? String(err)))
      }
    }

    void renderDoc()
    return () => { cancelled = true }
  }, [])

  return (
    <div>
      {error ? (
        <article className="card" style={{ padding: 20 }}>
          <h2>Curriculum Vitae</h2>
          <p className="text-muted">Unable to render DOCX: {error}</p>
          <p><a href="/media/rossmoney_cv.docx">Download CV</a></p>
        </article>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          <div ref={containerRef} />
          {/* viewer */}
        </div>
      )}
    </div>
  )
}
