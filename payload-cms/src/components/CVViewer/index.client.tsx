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
        // Post-process to flatten two-column tables and remove column layouts
        try {
          const normalize = (root: HTMLElement) => {
            // Remove width attributes and constrain elements to container width
            const all = Array.from(root.querySelectorAll('*')) as HTMLElement[]
            for (const el of all) {
              try {
                if (el.hasAttribute && el.hasAttribute('width')) el.removeAttribute('width')
              } catch {}
              el.style.maxWidth = '100%'
              el.style.boxSizing = 'border-box'
              // prevent unbreakable white-space
              if (el.style && (el.style.whiteSpace === 'nowrap')) {
                el.style.whiteSpace = 'normal'
              }
            }

            // Expand any column-style containers (e.g. style="column-count:2") by moving children out
            const columnEls = Array.from(root.querySelectorAll('[style]')).filter((e) => {
              const s = (e.getAttribute('style') || '').toLowerCase()
              return /column-count\s*:\s*\d+/.test(s)
            }) as HTMLElement[]
            for (const el of columnEls) {
              const parent = el.parentNode
              if (!parent) continue
              while (el.firstChild) parent.insertBefore(el.firstChild, el)
              parent.removeChild(el)
            }

            // Convert simple 2-column tables into stacked blocks so content flows vertically
            const tables = Array.from(root.querySelectorAll('table')) as HTMLTableElement[]
            for (const table of tables) {
              const rows = Array.from(table.rows || [])
              let maxCols = 0
              for (const r of rows) {
                const cells = Array.from(r.querySelectorAll('th,td'))
                if (cells.length > maxCols) maxCols = cells.length
              }
              if (maxCols === 2) {
                const wrapper = document.createElement('div')
                wrapper.className = 'cv-table-stack'
                for (const r of rows) {
                  const cells = Array.from(r.querySelectorAll('th,td'))
                  const block = document.createElement('div')
                  block.className = 'cv-block'
                  // left then right stacked
                  const left = document.createElement('div')
                  left.className = 'cv-left'
                  left.innerHTML = cells[0] ? cells[0].innerHTML : ''
                  const right = document.createElement('div')
                  right.className = 'cv-right'
                  right.innerHTML = cells[1] ? cells[1].innerHTML : ''
                  block.appendChild(left)
                  block.appendChild(right)
                  wrapper.appendChild(block)
                }
                table.replaceWith(wrapper)
              }
            }
          }
          normalize(container)
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('CV normalize failed', e)
        }
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
          <p className="text-muted">Unable to render DOCX: {error}</p>
          <p><a href="/media/rossmoney_cv.docx">Download CV</a></p>
        </article>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          <div className="cv-viewer-wrapper">
            <a className="cv-download-top" href="/media/rossmoney_cv.docx" download>
              Download CV (DOCX)
            </a>
            <div ref={containerRef} />
          </div>
        </div>
      )}
    </div>
  )
}
