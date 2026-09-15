"use client"
import React, { useEffect } from 'react'
import { buildFacts, buildHighlights, renderDiagram, extractDockerImages, titleFromPayload, descriptionFromPayload } from '@/utilities/archHelpers'

interface Props {
  project?: string
}

export const ArchitectureClient: React.FC<Props> = ({ project }) => {
  useEffect(() => {
    const meta = document.querySelector('meta[name="architecture-api"]') as HTMLMetaElement | null
    const architectureUrl = (meta && meta.content) || '/api/architecture'

    async function fetchArchitecture() {
      try {
        const url = architectureUrl + (architectureUrl.includes('?') ? '&' : '?') + `t=${Date.now()}` + (project ? `&project=${encodeURIComponent(project)}` : '')
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`Architecture fetch returned ${res.status}`)

        const ct = res.headers.get('content-type') || ''
        const payload = ct.includes('application/json') ? await res.json() : { raw: await res.text() }
        updateDom(payload)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('ArchitectureClient fetch failed', err)
      }
    }

    function updateDom(payload: any) {
      try {
        const titleEl = document.getElementById('architecture-title')
        const descEl = document.getElementById('architecture-description')
        const factsEl = document.getElementById('architecture-facts')
        const highlightsEl = document.getElementById('architecture-highlights')
        const diagramEl = document.getElementById('architecture-diagram')
        const imagesEl = document.getElementById('architecture-images')
        const imagesCountEl = document.getElementById('architecture-images-count')
        const rawEl = document.getElementById('architecture-raw')
        const updatedEl = document.getElementById('architecture-updated')

        const arch = payload || {}

        if (titleEl) titleEl.textContent = titleFromPayload(arch)
        if (descEl) descEl.textContent = descriptionFromPayload(arch)

        const facts = buildFacts(arch)
        if (factsEl) {
          factsEl.innerHTML = ''
          for (const [label, value] of facts) {
            const dt = document.createElement('dt')
            const dd = document.createElement('dd')
            dt.textContent = label
            dd.textContent = String(value)
            factsEl.appendChild(dt)
            factsEl.appendChild(dd)
          }
        }

        const highlights = buildHighlights(arch)
        if (highlightsEl) {
          highlightsEl.innerHTML = ''
          for (const section of highlights) {
            const art = document.createElement('article')
            art.className = 'mini-card'
            const span = document.createElement('span')
            span.className = 'mini-label'
            span.textContent = section.label
            const div = document.createElement('div')
            div.className = 'mini-value'
            if (Array.isArray(section.value)) {
              const ul = document.createElement('ul')
              for (const v of section.value.slice(0, 6)) {
                const li = document.createElement('li')
                li.textContent = String(v)
                ul.appendChild(li)
              }
              div.appendChild(ul)
            } else {
              div.textContent = String(section.value)
            }
            art.appendChild(span)
            art.appendChild(div)
            highlightsEl.appendChild(art)
          }
        }

        if (diagramEl) diagramEl.textContent = renderDiagram(arch)

        const archImages = extractDockerImages(arch)
        if (imagesEl) {
          imagesEl.innerHTML = ''
          if (archImages.length === 0) {
            const p = document.createElement('p')
            p.className = 'image-empty'
            p.textContent = 'No project images were returned by the Docker feed.'
            imagesEl.appendChild(p)
          } else {
        for (const img of archImages) {
          const card = document.createElement('article')
          card.className = 'image-card'
          const name = document.createElement('div')
          name.className = 'image-name'
          name.textContent = img.name
          card.appendChild(name)
          if (img.description) {
            const desc = document.createElement('p')
            desc.className = 'image-desc'
            desc.textContent = img.description
            card.appendChild(desc)
          }
          const meta = document.createElement('div')
          meta.className = 'image-meta'
              const sizeSpan = document.createElement('span')
              sizeSpan.textContent = img.sizeBytes ? `${(img.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : 'Unknown size'
              meta.appendChild(sizeSpan)

              // Show CPU and memory stats when available on the image object
              if (img.cpuPercent !== undefined && img.cpuPercent !== null) {
                const cpuSpan = document.createElement('span')
                cpuSpan.textContent = `CPU: ${String(img.cpuPercent)}%`
                meta.appendChild(cpuSpan)
              }

              if ((img.memoryUsedBytes || img.memoryUsedBytes === 0) && (img.memoryTotalBytes || img.memoryTotalBytes === 0)) {
                const memSpan = document.createElement('span')
                const used = img.memoryUsedBytes ? (img.memoryUsedBytes / (1024 * 1024)).toFixed(1) : '0.0'
                const total = img.memoryTotalBytes ? (img.memoryTotalBytes / (1024 * 1024)).toFixed(1) : '0.0'
                const pct = img.memoryPercent !== null && img.memoryPercent !== undefined ? ` (${img.memoryPercent}%)` : ''
                memSpan.textContent = `Mem: ${used} MB / ${total} MB${pct}`
                meta.appendChild(memSpan)
              }

              const dateSpan = document.createElement('span')
              dateSpan.textContent = img.created ? new Date(img.created).toLocaleString() : ''
              meta.appendChild(dateSpan)
              card.appendChild(meta)
              imagesEl.appendChild(card)
            }
          }
        }

        if (imagesCountEl) imagesCountEl.textContent = archImages.length ? `${archImages.length} image${archImages.length === 1 ? '' : 's'}` : 'No project images'
        if (rawEl) rawEl.textContent = arch ? JSON.stringify(arch, null, 2) : 'No snapshot returned'
        if (updatedEl) updatedEl.textContent = (new Date()).toLocaleString()
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('ArchitectureClient updateDom failed', e)
      }
    }

    // Attach refresh and perform an initial fetch
    const refreshBtn = document.getElementById('refresh-architecture')
    const handler = () => { void fetchArchitecture() }
    if (refreshBtn) refreshBtn.addEventListener('click', handler)

    // Load architecture immediately on client mount so the page isn't empty
    void fetchArchitecture()

    return () => {
      if (refreshBtn) refreshBtn.removeEventListener('click', handler)
    }
  }, [project])

  return null
}

export default ArchitectureClient
