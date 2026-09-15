import { PageDoc, RenderLayout } from './shared'
import { getServerSideURL } from '@/utilities/getURL'

export default async function TravellingTemplate({ page }: { page: PageDoc }) {
  const data = (page as any).data || {}
  const cards = Array.isArray(data.cards) ? data.cards : []

  // Attempt to hydrate server-rendered live data (commits, navigation, contact)
  let liveTravel: any = null
  try {
    const base = getServerSideURL()
    const res = await fetch(`${base}/api/cms/travel`, { cache: 'no-store' })
    if (res.ok) liveTravel = await res.json()
  } catch (err) {
    // Ignore network errors and fall back to seeded/page data
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch live travel feed', err)
  }

  const travelPayload = liveTravel?.travelling || { eyebrow: page.eyebrow, title: page.title, lead: page.lead, ...data }

  return (
    <main>
      <section className="hero container">
        <div className="hero-copy">
          <p className="eyebrow" id="travelling-eyebrow">{travelPayload.eyebrow || page.eyebrow || 'Travelling.rossmoney.me'}</p>
          <h1 id="travelling-title">{travelPayload.title || page.title || 'Travel archive built around a private image pipeline.'}</h1>
          <p className="lead" id="travelling-lead">{travelPayload.lead || page.lead || (data.summaryLead || 'The travelling project is the site for my 2016 Southeast Asia trip, built as a separate gallery stack around the photos from the trip.')}</p>

          <div className="hero-actions">
          {travelPayload.liveUrl || data.liveUrl ? (
              <a className="btn btn-primary" href={travelPayload.liveUrl || data.liveUrl} target="_blank" rel="noreferrer">Open live site</a>
            ) : (
              <a className="btn btn-primary" href="#" onClick={(e) => e.preventDefault()}>Open live site</a>
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

        <aside className="hero-panel card">
          <div className="panel-header">
            <div>
              <p className="panel-kicker" id="travelling-focus-kicker">{(travelPayload.focus && travelPayload.focus.kicker) || (data.focus && data.focus.kicker) || 'Project summary'}</p>
              <h2 id="travelling-focus-title">{(travelPayload.focus && travelPayload.focus.title) || (data.focus && data.focus.title) || (page.title ? page.title : 'Image mosaic, not a host overview.')}</h2>
            </div>
            <span className={`status-pill ${data.status === 'live' ? 'status-live' : ''}`} id="travelling-focus-status">{(data.status && data.status.charAt(0).toUpperCase() + data.status.slice(1)) || 'Live'}</span>
          </div>

          <div className="panel-grid" id="travelling-focus-items">
            {((travelPayload.focus && travelPayload.focus.items) || (data.focus && data.focus.items) || [
              { label: 'Scope', text: data.scope || 'Category-scoped to Travelling and tuned for public browsing.' },
              { label: 'Routing', text: data.routing || 'Static nginx delivery with an app-facing API layer for gallery data.' },
              { label: 'Protection', text: data.protection || 'Image URLs are hashed server-side before the frontend sees them.' },
            ]).map((it: any, idx: number) => (
              <div key={idx}>
                <span className="panel-label">{it.label}</span>
                <p>{it.text}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="section container">
        <div className="section-heading">
          <p className="eyebrow">What it is</p>
          <h2>A visual archive of the 2016 Southeast Asia journey.</h2>
          <p className="lead">{data.summaryLead || 'The travelling project is a separate gallery stack built to revisit the trip cleanly, with PhotoPrism as the photo source and a privacy-preserving API layer around the images.'}</p>
        </div>

        <div className="cards-grid">
          {cards.length > 0 ? (
            cards.map((c: any, i: number) => (
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
          <article className="architecture-summary card">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Snapshot</p>
                <h3 id="architecture-title">Waiting for data</h3>
              </div>
              <span className="status-pill" id="architecture-status">Loading</span>
            </div>

            <p className="architecture-description" id="architecture-description">Fetching the travelling architecture snapshot.</p>

            <dl className="facts-grid" id="architecture-facts"></dl>

            <div className="mini-grid" id="architecture-highlights"></div>
          </article>

          <article className="architecture-diagram card">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Topology</p>
                <h3>Travelling flow</h3>
              </div>
              <span className="status-pill status-muted" id="architecture-updated">Updating</span>
            </div>

            <pre className="diagram-view" id="architecture-diagram">Loading travelling architecture diagram...</pre>

            <div className="image-panel">
              <div className="panel-header image-panel-header">
                <div>
                  <p className="panel-kicker">Docker images</p>
                  <h3>Travel stack image inventory</h3>
                </div>
                <span className="status-pill status-muted" id="architecture-images-count">No project images</span>
              </div>

              <div className="image-grid" id="architecture-images"></div>
            </div>

            <div className="raw-json-wrap">
              <details>
                <summary>Raw snapshot</summary>
                <pre className="diagram-view" id="architecture-raw">Loading architecture snapshot...</pre>
              </details>
            </div>
          </article>
        </div>
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
              <h3 id="github-commits-status">Loading</h3>
            </div>
          </div>
          <pre className="diagram-view" id="github-commits">Loading recent commits...</pre>
        </div>
      </section>

      <section className="section container contact-section" id="contact">
        <div className="card contact-card">
          <div>
            <p className="eyebrow" id="contact-eyebrow">{(page as any).contact?.eyebrow || ''}</p>
            <h2 id="contact-title">{(page as any).contact?.title || ''}</h2>
            <p id="contact-lead">{(page as any).contact?.lead || ''}</p>
          </div>

          <div className="contact-links" id="contact-links">
            {((page as any).contact?.links || []).map((l: any, idx: number) => (
              <a key={idx} href={l.href} className="text-muted small">{l.label}</a>
            ))}
          </div>
        </div>
      </section>

      <RenderLayout page={page} />
    </main>
  )
}
