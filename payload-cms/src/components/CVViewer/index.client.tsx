"use client"
import React, { useEffect, useRef, useState } from 'react'
import type { Media } from '@/payload-types'
import {
  applyCVDocxRunStyle,
  cvDocxStyleMap,
  normalizeCVDocxForRendering,
} from './cvDocxStyles'

type Props = {
  cvFile?: Media | string | null
}

export function getCVFileUrl(cvFile: Props['cvFile']) {
  if (!cvFile || typeof cvFile === 'string') return null
  return cvFile.url || (cvFile.filename ? `/media/${cvFile.filename}` : null)
}

export default function CVViewer({ cvFile }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<{ message: string; url: string } | null>(null)
  const cvUrl = getCVFileUrl(cvFile)
  const errorMessage = error && error.url === cvUrl ? error.message : null

  useEffect(() => {
    let cancelled = false

    async function renderDoc() {
      try {
        if (!cvUrl) return
        const res = await fetch(cvUrl)
        if (!res.ok) throw new Error(`Failed to fetch CV (${res.status})`)
        const blob = await res.blob()

        const arrayBuffer = await normalizeCVDocxForRendering(await blob.arrayBuffer())
        // dynamic import to avoid build-time dependency problems
        const mammoth = await import('mammoth')
        // convert DOCX to HTML
        const result = await mammoth.convertToHtml(
          { arrayBuffer },
          {
            styleMap: cvDocxStyleMap,
            transformDocument: mammoth.transforms.run(applyCVDocxRunStyle),
          },
        )
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
        if (!cancelled && cvUrl) {
          setError({ message: String((err as any)?.message ?? String(err)), url: cvUrl })
        }
      }
    }

    void renderDoc()
    return () => { cancelled = true }
  }, [cvUrl])

  return (
    <div>
      {!cvUrl ? (
        <article className="card" style={{ padding: 20 }}>
          <p className="text-muted">CV document is not available right now.</p>
        </article>
      ) : errorMessage ? (
        <article className="card" style={{ padding: 20 }}>
          <p className="text-muted">Unable to render DOCX: {errorMessage}</p>
          <p><a href={cvUrl} download>Download CV</a></p>
        </article>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          <div className="cv-viewer-wrapper">
            <a className="cv-download-top" href={cvUrl} download>
              Download CV (DOCX)
            </a>
            <div ref={containerRef} />
          </div>
        </div>
      )}
    </div>
  )
}
