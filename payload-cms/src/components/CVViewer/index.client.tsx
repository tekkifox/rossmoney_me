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
          let pageJson = null
          if (pageRes.ok) {
            pageJson = await pageRes.json()
            const doc = Array.isArray(pageJson?.docs) && pageJson.docs.length ? pageJson.docs[0] : null
            const media = doc?.cvFile || null
            let url = null
            if (media) {
              url = media.url || (media.filename ? `/media/${media.filename}` : null)
            }
            // debug removed
            if (url) {
                const r = await fetch(url)
              if (r.ok) blob = await r.blob()
            }
          } else {
            // page fetch failed
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

        // dynamic import to avoid build-time dependency problems
        const docx = await import('docx-preview')

        const container = containerRef.current
        if (!container) return

        // attempt to render with sensible options
        await docx.renderAsync(blob, container, container, {
          className: 'docx',
          breakPages: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        })

        // Post-process the rendered HTML to improve mobile friendliness and avoid clipping:
        // Strategy:
        // - On small screens (<=720px) convert tables to a responsive stacked representation so no
        //   horizontal scroll is required and all content remains visible.
        // - On larger screens, convert simple 2-column tables to dl key/value lists and collapse
        //   very wide tables into details so they don't force the outer page to scroll.
        try {
          const postProcessDoc = (root: HTMLElement) => {
            const tables = Array.from(root.querySelectorAll('table')) as HTMLTableElement[]
            const smallScreen = window.innerWidth <= 720
            for (const table of tables) {
              // Avoid reprocessing the same table
              if (table.closest('.table-details') || table.closest('.kv-table') || table.closest('.responsive-table')) continue

              const rows = Array.from(table.querySelectorAll('tr'))
              let maxCols = 0
              for (const r of rows) {
                const cells = r.querySelectorAll('th,td')
                if (cells.length > maxCols) maxCols = cells.length
              }

              // On small screens, convert any table into a stacked responsive view so nothing is hidden
              if (smallScreen) {
                const headers: string[] = []
                // prefer thead headers
                const thead = table.querySelector('thead')
                if (thead) {
                  const ths = Array.from(thead.querySelectorAll('th'))
                  if (ths.length) headers.push(...ths.map(h => (h.textContent || '').trim()))
                }
                // fallback to first row as header
                if (headers.length === 0 && rows.length > 0) {
                  const firstCells = Array.from(rows[0].querySelectorAll('th,td'))
                  if (firstCells.length && rows.length > 1) {
                    headers.push(...firstCells.map(h => (h.textContent || '').trim()))
                    rows.shift() // treat remainder as body rows
                  }
                }
                if (headers.length === 0) {
                  for (let i = 0; i < maxCols; i++) headers.push('Column ' + (i + 1))
                }

                const wrap = document.createElement('div')
                wrap.className = 'responsive-table'
                for (const r of rows) {
                  const cells = Array.from(r.querySelectorAll('th,td'))
                  const rowWrap = document.createElement('div')
                  rowWrap.className = 'responsive-row'
                  for (let i = 0; i < headers.length; i++) {
                    const label = headers[i] || ('Column ' + (i + 1))
                    const cell = cells[i]
                    const item = document.createElement('div')
                    item.className = 'responsive-item'
                    const key = document.createElement('div')
                    key.className = 'responsive-key'
                    key.innerHTML = label
                    const val = document.createElement('div')
                    val.className = 'responsive-val'
                    val.innerHTML = cell ? cell.innerHTML : ''
                    item.appendChild(key)
                    item.appendChild(val)
                    rowWrap.appendChild(item)
                  }
                  wrap.appendChild(rowWrap)
                }
                table.replaceWith(wrap)
                continue
              }

              // Not small screen: handle two-column tables as dl for compactness
              if (maxCols === 2) {
                const dl = document.createElement('dl')
                dl.className = 'kv-table'
                for (const r of rows) {
                  const cells = Array.from(r.querySelectorAll('th,td'))
                  if (cells.length < 2) continue
                  const dt = document.createElement('dt')
                  dt.innerHTML = cells[0].innerHTML
                  const dd = document.createElement('dd')
                  dd.innerHTML = cells[1].innerHTML
                  dl.appendChild(dt)
                  dl.appendChild(dd)
                }
                table.replaceWith(dl)
                continue
              }

              // For larger screens, collapse very wide or many-column tables into details
              const containerWidth = root.clientWidth || window.innerWidth
              const tableWidth = table.scrollWidth || (table.getBoundingClientRect && table.getBoundingClientRect().width) || 0
              const shouldCollapse = tableWidth > containerWidth - 24 || maxCols > 6
              if (shouldCollapse) {
                const details = document.createElement('details')
                details.className = 'table-details'
                const summary = document.createElement('summary')
                summary.textContent = `Show table (${maxCols} columns)`
                table.parentNode?.insertBefore(details, table)
                details.appendChild(summary)
                details.appendChild(table)
                table.style.width = '100%'
                table.style.overflowX = 'auto'
                continue
              }

              // Otherwise enforce wrapping rules to avoid overflow
              table.style.tableLayout = 'fixed'
              table.style.wordBreak = 'break-word'
            }

            // Ensure code and pre wrap to avoid horizontal scroll
            const blocks = Array.from(root.querySelectorAll('pre, code')) as HTMLElement[]
            for (const b of blocks) {
              b.style.whiteSpace = 'pre-wrap'
              b.style.wordBreak = 'break-word'
            }
          }

          postProcessDoc(container)
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('CV post-processing failed', e)
        }
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('CV render failed', err)
        if (!cancelled) setError(String(err?.message || err))
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
