import Link from 'next/link'
import { getServerSideURL } from '@/utilities/getURL'

import { PageDoc, RenderLayout } from './shared'

export default async function HomeTemplate({ page }: { page: PageDoc }) {
  const data = (page as any).data || {}
  const focus = (page as any).focus || {}

  // Fetch the aggregated site payload so we can render live projects/experience/commits server-side
  let sitePayload: any = null
  try {
    const base = getServerSideURL()
    const res = await fetch(`${base}/api/cms/site`, { cache: 'no-store' })
    if (res.ok) sitePayload = await res.json()
  } catch (err) {
    // ignore and fall back to seeded/page content
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch site payload', err)
  }

  const projects = sitePayload?.projects || []
  const experience = sitePayload?.experience || []
  const homeData = sitePayload?.home || { ...data, focus }

  return (
    <main>
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
            <h2 id="architecture-section-title">Data streamed from the host Go service.</h2>
          </div>
          <button className="btn btn-secondary" type="button" id="refresh-architecture">Refresh snapshot</button>
        </div>

        <div className="architecture-layout">
          <article className="architecture-summary card">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Snapshot</p>
                <h3 id="architecture-title">Waiting for data</h3>
              </div>
              <span className="status-pill" id="architecture-status">Loading</span>
            </div>

            <p className="architecture-description" id="architecture-description">Fetching the current system shape from the host service.</p>

            <dl className="facts-grid" id="architecture-facts"></dl>

            <div className="mini-grid" id="architecture-highlights"></div>

            <div className="system-panel" id="architecture-system-stats"></div>
          </article>

          <article className="architecture-diagram card">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Topology</p>
                <h3>Structure view</h3>
              </div>
              <span className="status-pill status-muted" id="architecture-updated">Updating</span>
            </div>

            <pre className="diagram-view" id="architecture-diagram">Loading architecture diagram...</pre>

            <div className="image-panel">
              <div className="panel-header image-panel-header">
                <div>
                  <p className="panel-kicker">Docker images</p>
                  <h3>Project image inventory</h3>
                </div>
                <span className="status-pill status-muted" id="architecture-images-count">No project images</span>
              </div>

              <div className="image-grid" id="architecture-images"></div>
            </div>

            <div className="raw-json-wrap">
              <details>
                <summary>Raw payload</summary>
                <pre className="raw-json" id="architecture-raw">{}</pre>
              </details>
            </div>
          </article>
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
            <span className="status-pill status-muted" id="github-commits-status">Loading</span>
          </div>

          <pre className="diagram-view" id="github-commits">$ git log --oneline -n 5\nLoading recent commits...</pre>
        </article>
      </section>

      <section className="section container contact-section" id="contact">
        <div className="card contact-card">
          <div>
            <p className="eyebrow" id="contact-eyebrow"></p>
            <h2 id="contact-title"></h2>
            <p id="contact-lead"></p>
          </div>

          <div className="contact-links" id="contact-links"></div>
        </div>
      </section>

      <RenderLayout page={page} />
    </main>
  )
}
