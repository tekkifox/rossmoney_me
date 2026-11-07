// Scrollable snapshot regions must be reachable and scrollable with the keyboard.
// The <pre> is the element that scrolls, so it owns tabIndex and the region role.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role */
import React from 'react'
import Image from 'next/image'
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
import { renderDiagram, titleFromPayload, descriptionFromPayload } from '@/utilities/archHelpers'
import { architectureMetricsFromPayload } from '@/utilities/architectureMetrics'
import { loadArchitectureSnapshot, isArchviewSourceFailure } from '@/utilities/architectureSnapshot'
import ArchitectureClient from '@/components/ArchitectureClient/ArchitectureClient'

type SitePayload = {
  travelling?: unknown
  contact?: unknown
}

type CardData = {
  kicker?: string
  title?: string
  text?: string
}

function readCards(value: unknown): CardData[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const card = isRecord(entry) ? entry : {}
    return {
      kicker: readString(card.kicker),
      title: readString(card.title),
      text: readString(card.text),
    }
  })
}

export default async function TravellingTemplate({ page }: { page: PageDoc }) {
  const data = readPageData(page)
  // Prefer assembled site payload values (travelPayload) but fall back to page-level data
  // cards may live under page.data or under the assembled travelling payload

  let sitePayload: SitePayload | null = null
  try {
    sitePayload = await assembleSite()
  } catch {
    sitePayload = null
  }

  const travelPayload: UnknownRecord = isRecord(sitePayload?.travelling) ? sitePayload.travelling : { eyebrow: page.eyebrow, title: page.title, lead: page.lead, ...data }
  const travelData: UnknownRecord = isRecord(travelPayload.data) ? travelPayload.data : {}
  const cardsList = Array.isArray(travelPayload.cards) ? readCards(travelPayload.cards) : (Array.isArray(data.cards) ? readCards(data.cards) : [])
  const summaryLead = readString(travelPayload.summaryLead) ?? readString(travelData.summaryLead) ?? readString(data.summaryLead) ?? page.lead ?? ''

  // Server-side fetch of the redacted snapshot for this page
  const archPayload = await loadArchitectureSnapshot(page, travelPayload, {
    label: 'travelling',
    project: 'image-mosaic',
  })

  const archFailed = isArchviewSourceFailure(archPayload)
  const archFailureMessage = archFailed
    ? String((archPayload as Record<string, unknown>).message || 'Architecture source unavailable')
    : ''
  const archTitle = archFailed ? 'Architecture source unavailable' : titleFromPayload(archPayload)
  const archDesc = archFailed ? archFailureMessage : descriptionFromPayload(archPayload)
  const archDiagram = archFailed ? '' : renderDiagram(archPayload)
  const archMetrics = architectureMetricsFromPayload(archFailed ? null : archPayload)

  // Server-side fetch recent commits for the travel repo
  let commitsText = '$ git log --oneline -n 5\nLoading recent commits...'
  try {
    const { getGithubCommits } = await import('@/utilities/getGithubCommits')
    const commits = await getGithubCommits('tekkifox', 'travelling-site', 'main', 5)
    if (Array.isArray(commits) && commits.length > 0) {
      commitsText = ['$ git log --oneline -n 5', ...commits.map((c) => `${String(c.sha || '').slice(0, 7)} ${c.message || 'No commit message'}`)].join('\n')
    } else {
      commitsText = '$ git log --oneline -n 5\nNo commits returned'
    }
  } catch {
    commitsText = '$ git log --oneline -n 5\nUnable to load recent commits'
  }

  const liveUrl = (readString(travelPayload.liveUrl) || readString(data.liveUrl) || '').trim()
  const heroMetrics = readMetrics(travelPayload.metrics || data.metrics || [])

  return (
    <main id="main-content" tabIndex={-1}>
      <PageMeta page={page} />
    <section className="hero container">
      <div className="hero-copy">
        <p className="eyebrow" id="travelling-eyebrow">{readString(travelPayload.eyebrow) || page.eyebrow || 'Travelling.rossmoney.me'}</p>
        <h1 id="travelling-title">{readString(travelPayload.title) || page.title || 'Travel archive built around a private image pipeline.'}</h1>
          <p className="lead" id="travelling-lead">{readString(travelPayload.lead) || summaryLead || 'The travelling project is the site for my 2016 Southeast Asia trip, built as a separate gallery stack around the photos from the trip.'}</p>

        <div className="hero-actions">
          {/* Normalize and validate live URL; prefer https when scheme missing */}
          {(() => {
            const raw = liveUrl
            if (!raw) return (
              <button className="btn btn-primary" type="button" disabled title="Set a 'liveUrl' on the travelling page to enable this link">Open live site</button>
            )
            const hasScheme = /^https?:\/\//i.test(raw)
            const href = hasScheme ? raw : `https://${raw}`
            return (
              <a className="btn btn-primary" href={href} target="_blank" rel="noopener noreferrer">Open live site</a>
            )
          })()}
          <Link className="btn btn-secondary" href="/">Back to portfolio</Link>
        </div>

        <div className="hero-metrics" id="travelling-metrics" aria-label="Project highlights">
          {heroMetrics.map((m, i) => (
            <article key={i} className="metric">
              <span className="metric-value">{m.value}</span>
              <span className="metric-label">{m.label}</span>
            </article>
          ))}
        </div>
      </div>
    </section>

    <section className="section container" aria-label="Screenshot of the live travelling site">
      <figure className="project-screenshot-frame card">
        <Image
          alt="Screenshot of travelling.rossmoney.me: 'Asia Pacific 2016' over a dark blue hero with three summary panels."
          className="project-screenshot-image"
          height={1250}
          sizes="(max-width: 1140px) 100vw, 1116px"
          src="/projects/travelling.png"
          unoptimized
          width={2000}
        />
        <figcaption className="project-screenshot-caption">travelling.rossmoney.me — the live photo archive.</figcaption>
      </figure>
    </section>

    <section className="section container">
      <div className="section-heading">
        <p className="eyebrow">What it is</p>
        <h2>A visual archive of the 2016 Southeast Asia journey.</h2>
        <p className="lead">{summaryLead || 'The travelling project is a separate gallery stack built to revisit the trip cleanly, with PhotoPrism as the photo source and a privacy-preserving API layer around the images.'}</p>
      </div>

        <div className="cards-grid">
        {cardsList.length > 0 ? (
          cardsList.map((c, i) => (
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

      <output aria-atomic="true" aria-live="polite" className="sr-only" id="architecture-status" />

      <div className="architecture-layout">
        {/* Left column: topology */}
        <article className="architecture-diagram card">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Topology</p>
              <h3 id="architecture-title">{archTitle}</h3>
            </div>
            <span className="status-pill status-muted" id="architecture-updated">{archFailed ? 'Failed' : archPayload ? 'Updated' : 'Loading'}</span>
          </div>

          <p className="architecture-description" id="architecture-description">{archDesc}</p>

          {archFailed ? (
            <p className="architecture-failure" id="architecture-failure">{archFailureMessage}</p>
          ) : (
            <>
              <pre aria-label="Architecture diagram" className="diagram-view diagram-view-capped" data-architecture-diagram id="architecture-diagram" role="region" tabIndex={0}>{archDiagram}</pre>
              <details className="diagram-toggle">
                <summary>
                  <span className="diagram-toggle-closed">View full diagram</span>
                  <span className="diagram-toggle-open">Show less</span>
                </summary>
                <pre aria-label="Architecture diagram, full height" className="diagram-view diagram-view-full" data-architecture-diagram role="region" tabIndex={0}>{archDiagram}</pre>
              </details>
            </>
          )}
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
              <div id="architecture-metric-cpu" className="metric-card-value">{archMetrics.cpu}</div>
            </article>
            <article className="metric-card">
              <div className="metric-card-label">Memory</div>
              <div id="architecture-metric-memory" className="metric-card-value">{archMetrics.memory}</div>
            </article>
            <article className="metric-card">
              <div className="metric-card-label">Load</div>
              <div id="architecture-metric-load" className="metric-card-value">{archMetrics.load}</div>
            </article>
            <article className="metric-card">
              <div className="metric-card-label">Disk</div>
              <div id="architecture-metric-disk" className="metric-card-value">{archMetrics.disk}</div>
            </article>
            <article className="metric-card">
              <div className="metric-card-label">Swap</div>
              <div id="architecture-metric-swap" className="metric-card-value">{archMetrics.swap}</div>
            </article>
            <article className="metric-card">
              <div className="metric-card-label">Network</div>
              <div id="architecture-metric-network" className="metric-card-value">{archMetrics.network}</div>
            </article>
            <article className="metric-card">
              <div className="metric-card-label">Hosts</div>
              <div id="architecture-metric-hosts" className="metric-card-value">{archMetrics.hosts}</div>
            </article>
            <article className="metric-card">
              <div className="metric-card-label">Processes</div>
              <div id="architecture-metric-processes" className="metric-card-value">{archMetrics.processes}</div>
            </article>
            <article className="metric-card">
              <div className="metric-card-label">OS</div>
              <div id="architecture-metric-os" className="metric-card-value">{archMetrics.os}</div>
            </article>
          </div>
        </aside>
      </div>

      {/* Client-side hydration for refresh and live updates */}
      <ArchitectureClient
        project="image-mosaic"
        initialMetrics={archFailed ? null : archMetrics}
      />
    </section>

    <section className="section container">
      <div className="section-heading">
        <p className="eyebrow">Recent commits</p>
        <h2>Recent changes in the travelling-site repo.</h2>
      </div>
      <div className="card architecture-summary">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">GitHub</p>
          </div>
        </div>
        <pre aria-label="Recent commits" className="diagram-view" id="github-commits" role="region" tabIndex={0}>{commitsText}</pre>
      </div>
    </section>

    {/* Contact panel */}
    <ContactPanel contact={sitePayload?.contact || readPageContact(page) || page.data || null} />

    <RenderLayout page={page} />
    </main>
  )
}
