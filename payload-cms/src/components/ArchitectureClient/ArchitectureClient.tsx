"use client"
import React, { useEffect } from 'react'
import { buildFacts, buildHighlights, renderDiagram, extractDockerImages, titleFromPayload, descriptionFromPayload, buildMetrics, buildHostStats } from '@/utilities/archHelpers'

interface Props {
  project?: string
}

export const ArchitectureClient: React.FC<Props> = ({ project }) => {
  useEffect(() => {
    // Prefer a page-root data attribute when present (set by page wrapper) to guarantee page-level source
    let architectureUrl: string = '/api/architecture'
    const pageRoot = document.getElementById('page-root') as HTMLElement | null
    const pageApi = pageRoot?.dataset?.architectureApi
    if (pageApi && pageApi.trim()) {
      architectureUrl = pageApi.trim()
    } else {
      // Fallback to meta tag if no page data attribute provided
      const metas = Array.from(document.querySelectorAll('meta[name="architecture-api"]')) as HTMLMetaElement[]
      const meta = metas.length ? metas[metas.length - 1] : null
      architectureUrl = (meta && meta.content) || '/api/architecture'
    }

    async function fetchArchitecture() {
      try {
        const url = architectureUrl + (architectureUrl.includes('?') ? '&' : '?') + `t=${Date.now()}` + (project ? `&project=${encodeURIComponent(project)}` : '')
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`Architecture fetch returned ${res.status}`)

        const ct = res.headers.get('content-type') || ''
        const payload = ct.includes('application/json') ? await res.json() : { raw: await res.text() }
        updateDom(payload)
      } catch (err) {
      }
    }

    function updateDom(payload: any) {
      try {
        const titleEl = document.getElementById('architecture-title')
        const descEl = document.getElementById('architecture-description')
        const factsEl = document.getElementById('architecture-facts')
        const highlightsEl = document.getElementById('architecture-highlights')
        const diagramEl = document.getElementById('architecture-diagram')
        // image elements removed from layout; no-op placeholders kept for compatibility
        const imagesEl = null
        const imagesCountEl = null
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

        // Image cards removed per UI update. The topology now lists images and descriptions
        if (rawEl) rawEl.textContent = arch ? JSON.stringify(arch, null, 2) : 'No snapshot returned'
        if (updatedEl) {
          // Prefer server-provided timestamp when available
          const serverTs = arch?.updatedAt || arch?.telemetry?.metrics?.updatedAt || arch?.telemetry?.metrics?.loadSample
          try {
            if (serverTs) {
              const d = new Date(serverTs)
              if (!Number.isNaN(d.getTime())) updatedEl.textContent = d.toLocaleString()
              else updatedEl.textContent = String(serverTs)
            } else {
              updatedEl.textContent = (new Date()).toLocaleString()
            }
          } catch (e) {
            updatedEl.textContent = (new Date()).toLocaleString()
          }
        }

        // Always prefer telemetry from API. Do not compute from payload locally.
        const telemetry = (arch && arch.telemetry && arch.telemetry.metrics) ? arch.telemetry.metrics : null
        const cpuEl = document.getElementById('architecture-metric-cpu')
        const memEl = document.getElementById('architecture-metric-memory')
        const loadEl = document.getElementById('architecture-metric-load')
        if (cpuEl) cpuEl.textContent = telemetry && telemetry.cpuAvg !== null && telemetry.cpuAvg !== undefined ? `${Number(telemetry.cpuAvg)}%` : 'N/A'
        if (memEl) {
          if (telemetry && telemetry.memoryUsedBytes !== null && telemetry.memoryTotalBytes !== null) {
            const usedMB = (Number(telemetry.memoryUsedBytes) / (1024 * 1024)).toFixed(1)
            const totalMB = (Number(telemetry.memoryTotalBytes) / (1024 * 1024)).toFixed(1)
            const pct = telemetry.memoryPercent !== null && telemetry.memoryPercent !== undefined ? ` (${telemetry.memoryPercent}%)` : ''
            memEl.textContent = `${usedMB} MB / ${totalMB} MB${pct}`
          } else {
            memEl.textContent = 'N/A'
          }
        }
        if (loadEl) loadEl.textContent = telemetry && (telemetry.loadSample || telemetry.loadAvg) ? String(telemetry.loadSample || telemetry.loadAvg) : 'N/A'

        // Populate additional metric placeholders: disk, hosts count, top OS
        const diskEl = document.getElementById('architecture-metric-disk')
        const hostsCountEl = document.getElementById('architecture-metric-hosts')
        const osEl = document.getElementById('architecture-metric-os')
        try {
          // Only use telemetry from API for these cards
          const metricsFull = telemetry
          if (diskEl) {
            if (metricsFull && metricsFull.diskUsedBytes !== null && metricsFull.diskTotalBytes !== null) {
              const usedMB = (Number(metricsFull.diskUsedBytes) / (1024 * 1024)).toFixed(1)
              const totalMB = (Number(metricsFull.diskTotalBytes) / (1024 * 1024)).toFixed(1)
              const pct = metricsFull.diskPercent !== null && metricsFull.diskPercent !== undefined ? ` (${metricsFull.diskPercent}%)` : ''
              diskEl.textContent = `${usedMB} MB / ${totalMB} MB${pct}`
            } else {
              diskEl.textContent = 'N/A'
            }
          }
          if (hostsCountEl) hostsCountEl.textContent = metricsFull && metricsFull.hostCount ? String(metricsFull.hostCount) : '0'
          if (osEl) osEl.textContent = metricsFull && metricsFull.topOS ? String(metricsFull.topOS) : 'N/A'
          const netEl = document.getElementById('architecture-metric-network')
          const swapEl = document.getElementById('architecture-metric-swap')
          if (netEl) {
            if (metricsFull && ((metricsFull.networkRxMB !== null && metricsFull.networkRxMB !== undefined) || (metricsFull.networkTxMB !== null && metricsFull.networkTxMB !== undefined))) {
              const rx = (metricsFull.networkRxMB !== null && metricsFull.networkRxMB !== undefined) ? `${Number(metricsFull.networkRxMB).toFixed(1)} MB rx` : ''
              const tx = (metricsFull.networkTxMB !== null && metricsFull.networkTxMB !== undefined) ? `${Number(metricsFull.networkTxMB).toFixed(1)} MB tx` : ''
              netEl.textContent = [rx, tx].filter(Boolean).join(' / ') || 'N/A'
            } else {
              netEl.textContent = 'N/A'
            }
          }
          if (swapEl) {
            if (metricsFull && metricsFull.swapTotalBytes !== null && metricsFull.swapFreeBytes !== null) {
              const total = Number(metricsFull.swapTotalBytes)
              const free = Number(metricsFull.swapFreeBytes)
              const used = total - free
              const usedMB = (used / (1024 * 1024)).toFixed(1)
              const totalMB = (total / (1024 * 1024)).toFixed(1)
              const pct = metricsFull.swapPercent !== null && metricsFull.swapPercent !== undefined ? ` (${Number(metricsFull.swapPercent)}%)` : ''
              swapEl.textContent = `${usedMB} MB / ${totalMB} MB${pct}`
            } else {
              swapEl.textContent = 'N/A'
            }
          }
          const processEl = document.getElementById('architecture-metric-processes')
          if (processEl) {
            if (metricsFull && (metricsFull.processCount !== null && metricsFull.processCount !== undefined)) {
              processEl.textContent = String(metricsFull.processCount)
            } else {
              processEl.textContent = 'N/A'
            }
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('Failed to populate additional metrics', e)
        }
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
