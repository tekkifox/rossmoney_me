import React from 'react'
import { PageDoc, RenderLayout, ContactPanel } from './shared'
import { assembleSite } from '@/utilities/assembleSite'
// Note: ARCHVIEW base will be resolved from page data (projectPayload) when available; fall back to env.
import { buildFacts, buildHighlights, renderDiagram, extractDockerImages, titleFromPayload, descriptionFromPayload } from '@/utilities/archHelpers'
import ArchitectureClient from '@/components/ArchitectureClient/ArchitectureClient'
import { getGithubCommits } from '@/utilities/getGithubCommits'

export default async function GameServersTemplate({ page }: { page: PageDoc }) {
  try {
    const data = (page as any).data || {}

    let sitePayload: any = null
    try {
      sitePayload = await assembleSite()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('assembleSite failed for gameservers, falling back', err)
      sitePayload = null
    }

    const projectPayload = sitePayload?.gameservers || { eyebrow: page.eyebrow, title: page.title, lead: page.lead, ...data }
    const summaryLead = projectPayload.summaryLead ?? data.summaryLead ?? page.lead ?? ''

    let archPayload: any = null
    try {
      const archviewFromPage = projectPayload.archviewUrl || projectPayload.archview || data.archviewUrl || data.archview
      const envFallback = process.env.ARCHVIEW_VORTEXSERVERS_URL || process.env.ARCHVIEW_URL || process.env.ARCHVIEW_HOST || process.env.ARCHVIEW || 'http://archview:8080'
      const base = (archviewFromPage && String(archviewFromPage).trim()) || envFallback
      const url = `${base.replace(/\/$/, '')}/api/architecture?project=vortexservers_co_uk`
      const r = await fetch(url, { cache: 'no-store' })
      if (r.ok) archPayload = await r.json()
      else console.warn('ArchView returned', r.status, r.statusText, 'for', url)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to fetch architecture for gameservers', err)
    }

    const archTitle = titleFromPayload(archPayload)
    const archDesc = descriptionFromPayload(archPayload)
    const archDiagram = renderDiagram(archPayload)
    const archImages = extractDockerImages(archPayload)

    let commitsText = '$ git log --oneline -n 5\nLoading recent commits...'
    try {
      const commits = await getGithubCommits('tekkifox', 'vortexservers_co_uk', 'main', 5)
      if (Array.isArray(commits) && commits.length > 0) {
        commitsText = ['$ git log --oneline -n 5', ...commits.map((c: any) => `${String(c.sha || '').slice(0, 7)} ${c.message || 'No commit message'}`)].join('\n')
      } else {
        commitsText = '$ git log --oneline -n 5\nNo commits returned'
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to load GitHub commits for vortexservers_co_uk', err)
      commitsText = '$ git log --oneline -n 5\nUnable to load recent commits'
    }

    return (
      <main>
        {/* Reuse travelling-like layout but for Vortex project */}
        <section className="hero container">
          <div className="hero-copy">
            <p className="eyebrow" id="gameservers-eyebrow">{projectPayload.eyebrow || page.eyebrow}</p>
            <h1 id="gameservers-title">{projectPayload.title || page.title}</h1>
            <p className="lead" id="gameservers-lead">{projectPayload.lead || summaryLead}</p>
            <div className="hero-actions">
              {(() => {
                const raw = (projectPayload.liveUrl || data.liveUrl || '').trim()
                if (!raw) return (
                  <button className="btn btn-primary" type="button" disabled title="Set a 'liveUrl' on the gameservers page to enable this link">Open live site</button>
                )
                const hasScheme = /^https?:\/\//i.test(raw)
                const href = hasScheme ? raw : `https://${raw}`
                return (
                  <a className="btn btn-primary" href={href} target="_blank" rel="noopener noreferrer">Open live site</a>
                )
              })()}
              <a className="btn btn-secondary" href="/">Back to portfolio</a>
            </div>
          </div>
        </section>

        {/* Removed Project overview section: metrics shown in hero instead */}
        <div className="hero-metrics" aria-label="Highlights" id="hero-metrics">
          {(projectPayload.metrics || []).slice(0, 3).map((m: any, i: number) => (
            <article key={i} className="metric">
              <span className="metric-value">{m.value}</span>
              <span className="metric-label">{m.label}</span>
            </article>
          ))}
        </div>

        <section id="architecture" className="section container">
          <div className="section-heading architecture-heading">
            <div>
              <p className="eyebrow">Project architecture</p>
              <h2>Live architecture snapshot</h2>
            </div>
            <button className="btn btn-secondary" type="button" id="refresh-architecture">Refresh snapshot</button>
          </div>

          <div className="architecture-layout">
            <article className="architecture-diagram card">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Topology</p>
                  <h3 id="architecture-title">{archTitle}</h3>
                </div>
                <span className="status-pill status-muted" id="architecture-updated">{archPayload ? 'Updated' : 'Loading'}</span>
              </div>
              <p className="architecture-description" id="architecture-description">{archDesc}</p>
              <pre className="diagram-view" id="architecture-diagram">{archDiagram}</pre>
              <div className="raw-json-wrap"><details><summary>Raw snapshot</summary><pre className="raw-json" id="architecture-raw">{archPayload ? JSON.stringify(archPayload, null, 2) : 'No snapshot returned'}</pre></details></div>
            </article>

            <aside className="image-column card">
              <div className="panel-header image-panel-header"><div><p className="panel-kicker">Host stats</p></div></div>
              <div className="metrics-cards" id="architecture-metrics">
                <article className="metric-card"><div className="metric-card-label">CPU (avg)</div><div id="architecture-metric-cpu" className="metric-card-value">N/A</div></article>
                <article className="metric-card"><div className="metric-card-label">Memory</div><div id="architecture-metric-memory" className="metric-card-value">N/A</div></article>
                <article className="metric-card"><div className="metric-card-label">Load</div><div id="architecture-metric-load" className="metric-card-value">N/A</div></article>
                <article className="metric-card"><div className="metric-card-label">Disk</div><div id="architecture-metric-disk" className="metric-card-value">N/A</div></article>
                <article className="metric-card"><div className="metric-card-label">Swap</div><div id="architecture-metric-swap" className="metric-card-value">N/A</div></article>
                <article className="metric-card"><div className="metric-card-label">Network</div><div id="architecture-metric-network" className="metric-card-value">N/A</div></article>
                <article className="metric-card"><div className="metric-card-label">Hosts</div><div id="architecture-metric-hosts" className="metric-card-value">0</div></article>
                <article className="metric-card"><div className="metric-card-label">Processes</div><div id="architecture-metric-processes" className="metric-card-value">N/A</div></article>
                <article className="metric-card"><div className="metric-card-label">OS</div><div id="architecture-metric-os" className="metric-card-value">N/A</div></article>
              </div>
            </aside>
          </div>
          <ArchitectureClient project="vortexservers_co_uk" />
        </section>

        <section className="section container">
          <div className="section-heading"><p className="eyebrow">Recent commits</p><h2>Recent changes</h2></div>
          <div className="card architecture-summary"><pre className="diagram-view" id="github-commits">{commitsText}</pre></div>
        </section>

        <ContactPanel contact={sitePayload?.contact || (page as any).contact || ((page as any).data || null)} />
        <RenderLayout page={page} />
      </main>
    )
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error('GameServers template render error', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return (
      <main>
        <section className="container"><div className="card"><h2>Page unavailable</h2><p className="text-muted">{message}</p></div></section>
      </main>
    )
  }
}
