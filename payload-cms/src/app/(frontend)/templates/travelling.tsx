import React from 'react'
import { PageDoc, RenderLayout, ContactPanel } from './shared'
import { assembleSite } from '@/utilities/assembleSite'
import { buildFacts, buildHighlights, renderDiagram, extractDockerImages, titleFromPayload, descriptionFromPayload } from '@/utilities/archHelpers'
import ArchitectureClient from '@/components/ArchitectureClient/ArchitectureClient'

export default async function TravellingTemplate({ page }: { page: PageDoc }) {
  try {
    const data = (page as any).data || {}
    // Prefer assembled site payload values (travelPayload) but fall back to page-level data
    // cards may live under page.data or under the assembled travelling payload

    let sitePayload: any = null
    try {
      sitePayload = await assembleSite()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('assembleSite failed for travelling, falling back', err)
      sitePayload = null
    }

    const travelPayload = sitePayload?.travelling || { eyebrow: page.eyebrow, title: page.title, lead: page.lead, ...data }
    const cardsList = Array.isArray(travelPayload.cards) ? travelPayload.cards : (Array.isArray(data.cards) ? data.cards : [])
    const summaryTitle = travelPayload.summaryTitle ?? travelPayload.data?.summaryTitle ?? data.summaryTitle ?? ''
    const summaryLead = travelPayload.summaryLead ?? travelPayload.data?.summaryLead ?? data.summaryLead ?? page.lead ?? ''

    // Server-side fetch architecture snapshot via the CMS API route (ISR)
    let archPayload: any = null
    try {
      const r = await fetch(`/api/architecture?project=image-mosaic`, { cache: 'no-store' })
      if (r.ok) archPayload = await r.json()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to fetch architecture for travelling', err)
    }

    const archTitle = titleFromPayload(archPayload)
    const archDesc = descriptionFromPayload(archPayload)
    const archDiagram = renderDiagram(archPayload)
    const archImages = extractDockerImages(archPayload)

    // Server-side fetch recent commits for the travel repo
    let commitsText = '$ git log --oneline -n 5\nLoading recent commits...'
    try {
      const { getGithubCommits } = await import('@/utilities/getGithubCommits')
      const commits = await getGithubCommits('tekkifox', 'image-mosaic', 'main', 5)
      if (Array.isArray(commits) && commits.length > 0) {
        commitsText = ['$ git log --oneline -n 5', ...commits.map((c: any) => `${String(c.sha || '').slice(0, 7)} ${c.message || 'No commit message'}`)].join('\n')
      } else {
        commitsText = '$ git log --oneline -n 5\nNo commits returned'
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to load GitHub commits', err)
      commitsText = '$ git log --oneline -n 5\nUnable to load recent commits'
    }

    return (
      <main>
      <section className="hero container">
        <div className="hero-copy">
          <p className="eyebrow" id="travelling-eyebrow">{travelPayload.eyebrow || page.eyebrow || 'Travelling.rossmoney.me'}</p>
          <h1 id="travelling-title">{travelPayload.title || page.title || 'Travel archive built around a private image pipeline.'}</h1>
            <p className="lead" id="travelling-lead">{travelPayload.lead || summaryLead || 'The travelling project is the site for my 2016 Southeast Asia trip, built as a separate gallery stack around the photos from the trip.'}</p>

          <div className="hero-actions">
            {travelPayload.liveUrl || data.liveUrl ? (
              <a className="btn btn-primary" href={travelPayload.liveUrl || data.liveUrl} target="_blank" rel="noreferrer">Open live site</a>
            ) : (
              <button className="btn btn-primary" type="button">Open live site</button>
            )}
            <a className="btn btn-secondary" href="/">Back to portfolio</a>
          </div>

          <div className="hero-metrics" id="travelling-metrics" aria-label="Project highlights">
            {(travelPayload.metrics || data.metrics || []).map((m: any, i: number) => (
              <article key={i} className="metric">
                <span className="metric-value">{m.value}</span>
                <span className="metric-label">{m.label}</span>
              </article>
            ))}
          </div>
        </div>

        {/* hero aside removed: Trip summary not shown */}
      </section>

      <section className="section container">
        <div className="section-heading">
          <p className="eyebrow">What it is</p>
          <h2>A visual archive of the 2016 Southeast Asia journey.</h2>
          <p className="lead">{summaryLead || 'The travelling project is a separate gallery stack built to revisit the trip cleanly, with PhotoPrism as the photo source and a privacy-preserving API layer around the images.'}</p>
        </div>

          <div className="cards-grid">
          {cardsList.length > 0 ? (
            cardsList.map((c: any, i: number) => (
              <article key={i} className="feature-card card">
                {c.kicker && <p className="card-kicker">{c.kicker}</p>}
                {c.title && <h3>{c.title}</h3>}
                {c.text && <p>{c.text}</p>}
              </article>
            ))
          ) : (
            <>
              <article className="feature-card card"><p className="card-kicker">Story</p><h3>Round trip through Asia</h3><p>I went travelling round Southeast Asia in 2016, then continued through South Korea, Japan, Hong Kong, and Australia.</p></article>
              <article className="feature-card card"><p className="card-kicker">Place</p><h3>Destinations and highlights</h3><p>The gallery is organized around the places visited on the trip, making it easier to browse the route and the memories together.</p></article>
              <article className="feature-card card"><p className="card-kicker">Format</p><h3>Photo-first archive</h3><p>It is less a blog and more a private image mosaic, with supporting route notes and a lightweight travel narrative.</p></article>
              <article className="feature-card card"><p className="card-kicker">Audience</p><h3>Personal reference</h3><p>The site is mainly for revisiting the trip myself, while still being polished enough to share publicly.</p></article>
            </>
          )}
        </div>
      </section>

      <section id="architecture" className="section container">
        <div className="section-heading architecture-heading">
          <div>
            <p className="eyebrow">Travel architecture feed</p>
            <h2>Architecture for travelling.rossmoney.me.</h2>
          </div>
          <button className="btn btn-secondary" type="button" id="refresh-architecture">Refresh snapshot</button>
        </div>

        <div className="architecture-layout">
          {/* Left column: topology and raw payload */}
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

            <div className="raw-json-wrap">
              <details>
                <summary>Raw snapshot</summary>
                <pre className="raw-json" id="architecture-raw">{archPayload ? JSON.stringify(archPayload, null, 2) : 'No snapshot returned'}</pre>
              </details>
            </div>
          </article>

          {/* Right column: images */}
          <aside className="image-column card">
            <div className="panel-header image-panel-header">
              <div>
                <p className="panel-kicker">Host stats</p>
              </div>
            </div>
            <div className="metrics-cards" id="architecture-metrics">
              <article className="metric-card">
                <div className="metric-card-label">CPU (avg)</div>
                <div id="architecture-metric-cpu" className="metric-card-value">N/A</div>
              </article>
              <article className="metric-card">
                <div className="metric-card-label">Memory</div>
                <div id="architecture-metric-memory" className="metric-card-value">N/A</div>
              </article>
              <article className="metric-card">
                <div className="metric-card-label">Load</div>
                <div id="architecture-metric-load" className="metric-card-value">N/A</div>
              </article>
              <article className="metric-card">
                <div className="metric-card-label">Disk</div>
                <div id="architecture-metric-disk" className="metric-card-value">N/A</div>
              </article>
              <article className="metric-card">
                <div className="metric-card-label">Swap</div>
                <div id="architecture-metric-swap" className="metric-card-value">N/A</div>
              </article>
              <article className="metric-card">
                <div className="metric-card-label">Network</div>
                <div id="architecture-metric-network" className="metric-card-value">N/A</div>
              </article>
              <article className="metric-card">
                <div className="metric-card-label">Hosts</div>
                <div id="architecture-metric-hosts" className="metric-card-value">0</div>
              </article>
              <article className="metric-card">
                <div className="metric-card-label">Processes</div>
                <div id="architecture-metric-processes" className="metric-card-value">N/A</div>
              </article>
              <article className="metric-card">
                <div className="metric-card-label">OS</div>
                <div id="architecture-metric-os" className="metric-card-value">N/A</div>
              </article>
            </div>
          </aside>
        </div>
        {/* Client-side hydration for refresh and live updates */}
        <ArchitectureClient project="image-mosaic" />
      </section>

      <section className="section container">
        <div className="section-heading">
          <p className="eyebrow">Recent commits</p>
          <h2>Recent changes in the image-mosaic repo.</h2>
        </div>
        <div className="card architecture-summary">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">GitHub</p>
            </div>
          </div>
          <pre className="diagram-view" id="github-commits">{commitsText}</pre>
        </div>
      </section>

      {/* Contact panel */}
      <ContactPanel contact={sitePayload?.contact || (page as any).contact || ((page as any).data || null)} />

      <RenderLayout page={page} />
    </main>
  )
  } catch (err: unknown) {
    // Render a safe fallback instead of bubbling a 500
    // eslint-disable-next-line no-console
    console.error('Travelling template render error', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return (
      <main>
        <section className="container">
          <div className="card">
            <h2>Page unavailable</h2>
            <p className="text-muted">{message}</p>
          </div>
        </section>
      </main>
    )
  }
}
