import React from 'react'
import Link from 'next/link'
import {
  PageDoc,
  RenderLayout,
  ContactPanel,
  PageMeta,
  UnknownRecord,
  isRecord,
  readMetrics,
  readPageContact,
  readPageData,
  readString,
} from './shared'
import { assembleSite } from '@/utilities/assembleSite'
// Note: the source is resolved from the page relation, legacy URL text, the default row, then env.
import { renderDiagram, titleFromPayload, descriptionFromPayload } from '@/utilities/archHelpers'
import { stripUptimesForRawDump } from '@/utilities/architectureUptimes'
import { archviewFetchForPageSource, resolvePageArchviewSource } from '@/utilities/archviewPageSource'
import { getSafePayload } from '@/utilities/getSafePayload'
import ArchitectureClient from '@/components/ArchitectureClient/ArchitectureClient'
import { getGithubCommits } from '@/utilities/getGithubCommits'
import { redactInternalEndpoints } from '@/utilities/redactInternalEndpoints'

type SitePayload = {
  gameservers?: unknown
  contact?: unknown
}

export default async function GameServersTemplate({ page }: { page: PageDoc }) {
  const data = readPageData(page)

  let sitePayload: SitePayload | null = null
  try {
    sitePayload = await assembleSite()
  } catch (err) {
    console.warn('assembleSite failed for gameservers, falling back', err)
    sitePayload = null
  }

  const projectPayload: UnknownRecord = isRecord(sitePayload?.gameservers) ? sitePayload.gameservers : { eyebrow: page.eyebrow, title: page.title, lead: page.lead, ...data }
  const summaryLead = readString(projectPayload.summaryLead) ?? readString(data.summaryLead) ?? page.lead ?? ''

  let archPayload: Record<string, unknown> | null = null
  try {
    const resolvedSource = await resolvePageArchviewSource(page, projectPayload, {
      payload: await getSafePayload(),
    })
    const envFallback = process.env.ARCHVIEW_URL || process.env.ARCHVIEW_HOST || process.env.ARCHVIEW || 'http://localhost:8080'
    const base = resolvedSource?.origin || envFallback
    const url = `${base.replace(/\/$/, '')}/api/architecture?project=vortexservers_co_uk`
    const r = await archviewFetchForPageSource(url, { cache: 'no-store' }, resolvedSource)
    if (r.ok) archPayload = redactInternalEndpoints((await r.json()) as Record<string, unknown>)
    else console.warn('ArchView returned', r.status, r.statusText, 'for', url)
  } catch (err) {
    console.warn('Failed to fetch architecture for gameservers', err)
  }

  const archTitle = titleFromPayload(archPayload)
  const archDesc = descriptionFromPayload(archPayload)
  const archDiagram = renderDiagram(archPayload)

  let commitsText = '$ git log --oneline -n 5\nLoading recent commits...'
  try {
    const commits = await getGithubCommits('tekkifox', 'vortexservers_co_uk', 'main', 5)
    if (Array.isArray(commits) && commits.length > 0) {
      commitsText = ['$ git log --oneline -n 5', ...commits.map((c) => `${String(c.sha || '').slice(0, 7)} ${c.message || 'No commit message'}`)].join('\n')
    } else {
      commitsText = '$ git log --oneline -n 5\nNo commits returned'
    }
  } catch (err) {
    console.warn('Failed to load GitHub commits for vortexservers_co_uk', err)
    commitsText = '$ git log --oneline -n 5\nUnable to load recent commits'
  }

  const liveUrl = (readString(projectPayload.liveUrl) || readString(data.liveUrl) || '').trim()
  const heroMetrics = readMetrics(projectPayload.metrics || [])

  return (
    <main>
      <PageMeta page={page} />
      {/* Reuse travelling-like layout but for Vortex project */}
      <section className="hero container">
        <div className="hero-copy">
          <p className="eyebrow" id="gameservers-eyebrow">{readString(projectPayload.eyebrow) || page.eyebrow}</p>
          <h1 id="gameservers-title">{readString(projectPayload.title) || page.title}</h1>
          <p className="lead" id="gameservers-lead">{readString(projectPayload.lead) || summaryLead}</p>
          <div className="hero-actions">
            {(() => {
              const raw = liveUrl
              if (!raw) return (
                <button className="btn btn-primary" type="button" disabled title="Set a 'liveUrl' on the gameservers page to enable this link">Open live site</button>
              )
              const hasScheme = /^https?:\/\//i.test(raw)
              const href = hasScheme ? raw : `https://${raw}`
              return (
                <a className="btn btn-primary" href={href} target="_blank" rel="noopener noreferrer">Open live site</a>
              )
            })()}
            <Link className="btn btn-secondary" href="/">Back to portfolio</Link>

          </div>
          <div className="hero-metrics" aria-label="Highlights" id="hero-metrics">
            {heroMetrics.slice(0, 3).map((m, i) => (
              <article key={i} className="metric">
                <span className="metric-value">{m.value}</span>
                <span className="metric-label">{m.label}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

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
            <div className="raw-json-wrap"><details><summary>Raw snapshot</summary><pre className="raw-json" id="architecture-raw">{archPayload ? JSON.stringify(stripUptimesForRawDump(archPayload), null, 2) : 'No snapshot returned'}</pre></details></div>
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

      <ContactPanel contact={sitePayload?.contact || readPageContact(page) || page.data || null} />
      <RenderLayout page={page} />
    </main>
  )
}
