import Link from 'next/link'
import React from 'react'
import { assembleSite } from '@/utilities/assembleSite'
// Query ArchView directly from server-side to avoid requesting the Next server itself
const ARCHVIEW_BASE = process.env.ARCHVIEW_URL || process.env.ARCHVIEW_HOST || process.env.ARCHVIEW || 'http://archview:8080'
import { buildFacts, buildHighlights, renderDiagram, extractDockerImages, titleFromPayload, descriptionFromPayload } from '@/utilities/archHelpers'
import ArchitectureClient from '@/components/ArchitectureClient/ArchitectureClient'

import { PageDoc, RenderLayout, ContactPanel, PageMeta } from './shared'

export default async function HomeTemplate({ page }: { page: PageDoc }) {
  const data = (page as any).data || {}
  const focus = (page as any).focus || {}

  let sitePayload: any = null
  try {
    sitePayload = await assembleSite()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('assembleSite failed, falling back to page data', err)
    sitePayload = { home: { ...data, focus }, projects: [], experience: [], contact: null }
  }

  const projects = sitePayload?.projects || []
  const experience = sitePayload?.experience || []
  const homeData = sitePayload?.home || { ...data, focus }

  // Server-side fetch of architecture snapshot via CMS API route (ISR)
  let archPayload: any = null
  try {
    const res = await fetch(`/api/architecture`, { cache: 'no-store' })
    if (res.ok) archPayload = await res.json()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch architecture snapshot', err)
  }

  const archTitle = titleFromPayload(archPayload)
  const archDesc = descriptionFromPayload(archPayload)
  const archDiagram = renderDiagram(archPayload)
  const archImages = extractDockerImages(archPayload)
  
  // Optionally show recent commits for the site repo (homepage uses portfolio repo)
  let homepageCommitsText = null
  try {
    const { getGithubCommits } = await import('@/utilities/getGithubCommits')
    const commits = await getGithubCommits('tekkifox', 'rossmoney_me', 'main', 5)
    if (Array.isArray(commits) && commits.length > 0) {
      homepageCommitsText = ['$ git log --oneline -n 5', ...commits.map((c: any) => `${String(c.sha || '').slice(0, 7)} ${c.message || 'No commit message'}`)].join('\n')
    }
  } catch (err) {
    // ignore
  }

  return (
    <main>
      <PageMeta page={page} />
      <section className="hero container">
        <div className="hero-copy">
          <p className="eyebrow" id="hero-eyebrow">{page.eyebrow || ''}</p>
          <h1 id="hero-title">{page.title || ''}</h1>
          <p className="lead" id="hero-lead">{page.lead || ''}</p>

          <div className="hero-actions">
            {homeData.primaryButton?.label && homeData.primaryButton?.href ? (
              <Link id="hero-primary-button" className="btn btn-primary" href={homeData.primaryButton.href}>{homeData.primaryButton.label}</Link>
            ) : (
              <a id="hero-primary-button" className="btn btn-primary" href="#contact">Start a conversation</a>
            )}

            {homeData.secondaryButton?.label && homeData.secondaryButton?.href ? (
              <Link id="hero-secondary-button" className="btn btn-secondary" href={homeData.secondaryButton.href}>{homeData.secondaryButton.label}</Link>
            ) : (
              <a id="hero-secondary-button" className="btn btn-secondary" href="#architecture">Inspect live architecture</a>
            )}

            <Link id="hero-travelling-button" className="btn btn-secondary" href="/travelling">Travelling</Link>
          </div>

          <div className="hero-metrics" aria-label="Highlights" id="hero-metrics">
            {(homeData.metrics || []).map((m: any, i: number) => (
              <article key={i} className="metric">
                <span className="metric-value">{m.value}</span>
                <span className="metric-label">{m.label}</span>
              </article>
            ))}
          </div>
        </div>

        <aside className="hero-panel card">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Current focus</p>
              <h2>{homeData.focus?.title || focus.title || 'Building personal infrastructure'}</h2>
            </div>
            <span className="status-pill status-live">Live</span>
          </div>

          <div className="panel-grid">
            {(homeData.focus?.items || focus.items || []).map((item: any, idx: number) => (
              <div key={idx} className="card">
                <p className="text-xs uppercase text-muted">{item.label}</p>
                <p className="mt-1">{item.value}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="section container" id="work">
        <div className="section-heading">
          <p className="eyebrow" id="work-section-eyebrow">Selected work</p>
          <h2 id="work-section-title">Real roles and projects from my CV.</h2>
        </div>

        <div className="cards-grid" id="cms-projects">
          {projects.slice(0, 6).map((project: any, i: number) => (
            <article key={i} className="feature-card card">
              <p className="card-kicker">{project.role}</p>
              <h3>{project.title}</h3>
              <p>{project.summary}</p>
            </article>
          ))}
        </div>
      </section>
      <ArchitectureClient project="rossmoney_me" />

      <section className="section container" id="experience">
        <div className="section-heading">
          <p className="eyebrow" id="experience-section-eyebrow">Experience</p>
          <h2 id="experience-section-title">Recent delivery history.</h2>
        </div>

        <div className="timeline" id="cms-experience">
          {experience.slice(0, 6).map((entry: any, i: number) => (
            <article key={i} className="timeline-item">
              <p className="timeline-year">{entry.year}</p>
              <div>
                <h3>{[entry.title, entry.organization].filter(Boolean).join(' · ')}</h3>
                <p>{entry.summary}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section container architecture-section" id="architecture">
            <div className="section-heading architecture-heading">
          <div>
            <p className="eyebrow" id="architecture-section-eyebrow">Live architecture example</p>
            <h2 id="architecture-section-title">Live architecture snapshot</h2>
          </div>
          <button className="btn btn-secondary" type="button" id="refresh-architecture">Refresh snapshot</button>
        </div>

        <div className="architecture-layout">
          {/* Left: topology + raw */}
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
                <summary>Raw payload</summary>
                <pre className="raw-json" id="architecture-raw">{archPayload ? JSON.stringify(archPayload, null, 2) : 'No snapshot returned'}</pre>
              </details>
            </div>
          </article>

          {/* Right: images inventory */}
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
      </section>

      <section className="section container" id="commits">
        <div className="section-heading">
          <p className="eyebrow" id="commits-section-eyebrow">Recent commits</p>
          <h2 id="commits-section-title">Last few GitHub commits from my portfolio repo.</h2>
        </div>

        <article className="card commits-card">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">git log</p>
              <h3>tekkifox / rossmoney_me</h3>
            </div>
          </div>

          <pre className="diagram-view" id="github-commits">{homepageCommitsText || '$ git log --oneline -n 5\nLoading recent commits...'}</pre>
        </article>
      </section>

      {/* Contact panel */}
      <ContactPanel contact={sitePayload?.contact || (page as any).contact || ((page as any).data || null)} />

      <RenderLayout page={page} />
    </main>
  )
}
