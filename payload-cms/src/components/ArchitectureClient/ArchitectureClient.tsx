"use client"
import React, { useEffect, useRef } from 'react'
import { buildFacts, buildHighlights, renderDiagram, titleFromPayload, descriptionFromPayload } from '@/utilities/archHelpers'
import { redactInternalEndpoints } from '@/utilities/redactInternalEndpoints'
import { stripUptimesForRawDump } from '@/utilities/architectureUptimes'
import {
  architectureMetricsFromPayload,
  type ArchitectureMetricValues,
} from '@/utilities/architectureMetrics'

interface Props {
  project?: string
  /**
   * Metrics already rendered by the server. Applying them on mount keeps the
   * cards correct without asking the proxy for the same snapshot again.
   */
  initialMetrics?: ArchitectureMetricValues | null
}

interface ArchitectureMetrics {
  updatedAt?: string | number
  loadSample?: string | number
  loadAvg?: string | number
  cpuAvg?: string | number
  memoryUsedBytes?: string | number
  memoryTotalBytes?: string | number
  memoryPercent?: string | number
  diskUsedBytes?: string | number
  diskTotalBytes?: string | number
  diskPercent?: string | number
  hostCount?: string | number
  topOS?: string | number
  networkRxMB?: string | number
  networkTxMB?: string | number
  swapTotalBytes?: string | number
  swapFreeBytes?: string | number
  swapPercent?: string | number
  processCount?: string | number
}

interface ArchitecturePayload {
  updatedAt?: string | number
  telemetry?: {
    metrics?: ArchitectureMetrics
  }
  [key: string]: unknown
}

// The server has already rendered a snapshot, so polling is only a freshness
// check. ArchView's sample cadence does not justify a request every 10 seconds;
// 45 seconds keeps the panel current without turning every visitor into a load
// generator against the upstream (and matches the proxy cache TTL).
const REFRESH_INTERVAL_MS = 45000

export const ArchitectureClient: React.FC<Props> = ({ project, initialMetrics }) => {
  const inFlightRef = useRef(false)

  useEffect(() => {
    const pageRoot = document.getElementById('page-root') as HTMLElement | null
    // When the page's requested source could not be honoured, never fetch the
    // generic proxy endpoint: it would silently substitute another host's data.
    if (pageRoot?.dataset?.architectureUnavailable === 'true') {
      return
    }

    let architectureUrl: string = '/api/architecture'
    const pageApi = pageRoot?.dataset?.architectureApi
    if (pageApi && pageApi.trim()) {
      architectureUrl = pageApi.trim()
    } else {
      // Fallback to meta tag if no page data attribute provided
      const metas = Array.from(document.querySelectorAll('meta[name="architecture-api"]')) as HTMLMetaElement[]
      const meta = metas.length ? metas[metas.length - 1] : null
      architectureUrl = (meta && meta.content) || '/api/architecture'
    }

    // The resolved source row owns the project label. Fall back to the prop the
    // template passes while a source has no project configured yet.
    const pageProject = pageRoot?.dataset?.architectureProject?.trim()
    const projectLabel = pageProject || project

    const statusEl = document.getElementById('architecture-status')
    const sectionEl = document.getElementById('architecture')
    // `Updated` means the server rendered a snapshot; `Loading` is the
    // degraded state where the panel has nothing to show yet.
    const updatedEl = document.getElementById('architecture-updated')
    const serverRenderedSnapshot =
      Boolean(updatedEl?.textContent?.trim()) && updatedEl?.textContent?.trim() !== 'Loading'
    let lastFetchAt = serverRenderedSnapshot ? Date.now() : 0
    let lastStatus = ''

    function announceStatus(message: string) {
      if (!statusEl || message === lastStatus) return
      lastStatus = message
      statusEl.textContent = message
    }

    function setBusy(busy: boolean) {
      sectionEl?.setAttribute('aria-busy', busy ? 'true' : 'false')
    }

    function applyMetrics(values: ArchitectureMetricValues) {
      const setText = (id: string, text: string) => {
        const el = document.getElementById(id)
        if (el) el.textContent = text
      }
      setText('architecture-metric-cpu', values.cpu)
      setText('architecture-metric-memory', values.memory)
      setText('architecture-metric-load', values.load)
      setText('architecture-metric-disk', values.disk)
      setText('architecture-metric-swap', values.swap)
      setText('architecture-metric-network', values.network)
      setText('architecture-metric-hosts', values.hosts)
      setText('architecture-metric-processes', values.processes)
      setText('architecture-metric-os', values.os)
    }

    async function fetchArchitecture() {
      if (inFlightRef.current) return
      inFlightRef.current = true
      lastFetchAt = Date.now()
      setBusy(true)
      try {
        const url = architectureUrl + (architectureUrl.includes('?') ? '&' : '?') + `t=${Date.now()}` + (projectLabel ? `&project=${encodeURIComponent(projectLabel)}` : '')
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) {
          let reason = `Architecture fetch returned ${res.status}`
          try {
            const ct = res.headers.get('content-type') || ''
            if (ct.includes('application/json')) {
              const body = await res.json()
              if (body && typeof body.reason === 'string') reason = body.reason
              if (body && typeof body.description === 'string') reason = body.description
            }
          } catch {
          }
          throw new Error(reason)
        }

        const ct = res.headers.get('content-type') || ''
        const payload = ct.includes('application/json') ? await res.json() : { raw: await res.text() }
        updateDom(payload)
        announceStatus('Architecture snapshot updated.')
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Architecture request failed'
        const descEl = document.getElementById('architecture-description')
        const updatedEl = document.getElementById('architecture-updated')
        if (descEl) descEl.textContent = reason
        if (updatedEl) updatedEl.textContent = 'Failed'
        announceStatus(`Architecture snapshot could not be refreshed: ${reason}`)
      } finally {
        inFlightRef.current = false
        setBusy(false)
      }
    }

    function updateDom(payload: ArchitecturePayload) {
      try {
        const titleEl = document.getElementById('architecture-title')
        const descEl = document.getElementById('architecture-description')
        const factsEl = document.getElementById('architecture-facts')
        const highlightsEl = document.getElementById('architecture-highlights')
        const diagramEl = document.getElementById('architecture-diagram')
        const rawEl = document.getElementById('architecture-raw')
        const updatedEl = document.getElementById('architecture-updated')

        const arch: ArchitecturePayload = redactInternalEndpoints(payload || {})

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
        if (rawEl) rawEl.textContent = arch ? JSON.stringify(stripUptimesForRawDump(arch), null, 2) : 'No snapshot returned'
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
          } catch {
            updatedEl.textContent = (new Date()).toLocaleString()
          }
        }

        // Always prefer telemetry from API. Do not compute from payload locally.
        try {
          applyMetrics(architectureMetricsFromPayload(arch))
        } catch (e) {
          console.warn('Failed to populate architecture metrics', e)
        }
      } catch (e) {
        console.warn('ArchitectureClient updateDom failed', e)
      }
    }

    // The server already wrote these values into the card markup. Re-applying
    // them from the snapshot prop keeps the cards correct through hydration
    // without fetching the same snapshot again.
    if (initialMetrics) {
      applyMetrics(initialMetrics)
    }

    // Attach refresh and perform an initial fetch
    const refreshBtn = document.getElementById('refresh-architecture')
    const handler = () => {
      // A manual refresh should always be reported, even when the previous
      // automatic update announced the same text.
      lastStatus = ''
      void fetchArchitecture()
    }
    if (refreshBtn) refreshBtn.addEventListener('click', handler)

    // Poll every REFRESH_INTERVAL_MS, skipping ticks while the tab is hidden
    const intervalId = setInterval(() => {
      if (document.hidden) return
      void fetchArchitecture()
    }, REFRESH_INTERVAL_MS)

    // Catch up when the tab becomes visible again, but not more often than the
    // poll interval (switching tabs is not a refresh request).
    const onVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastFetchAt >= REFRESH_INTERVAL_MS) {
        void fetchArchitecture()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // The server already rendered a snapshot, so do not fetch again on mount.
    // Only a degraded server render (no snapshot) needs an immediate retry.
    if (!serverRenderedSnapshot) {
      void fetchArchitecture()
    }

    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (refreshBtn) refreshBtn.removeEventListener('click', handler)
    }
  }, [project, initialMetrics])

  return null
}

export default ArchitectureClient
