# Analytics ingestion (Ackee)

Ackee runs on the analytics host as the `ackee` and `ackee-mongo` containers,
on the same Docker network as the CMS. The CMS reaches the app directly at
`http://ackee:3000`; the dashboard is not published on a public host port.

## Ingestion path

The public site proxies Ackee first-party, so the CSP needs no new source:

```text
browser
  └─ <site-origin>/a/tracker.js  → http://ackee:3000/tracker.js
  └─ <site-origin>/a/api/*       → http://ackee:3000/api/*
```

`payload-cms/next.config.ts` owns the `/a/:path*` rewrite. It is a
`beforeFiles` rewrite, so the `[slug]` page route cannot shadow it, and `/a` is
not an existing route. The same file excludes `/a` from the blanket security
headers and from the `/api/*` cache rule; `payload-cms/src/proxy.ts` skips it
too, so proxied responses keep Ackee's own headers rather than the CMS CSP.

The tracker posts to the collection API at `<site-origin>/a/api`, which
`connect-src 'self'` already covers. The script is same-origin, so the static
script allowlist on cached public documents (`script-src 'self' 'unsafe-inline'`)
permits it. No nonce is needed there: a prerendered document cannot carry a
per-request nonce. Dynamic surfaces keep the nonce policy.

## Tracker

`payload-cms/src/components/AckeeTracker/index.tsx` is rendered from the public
page renderer (not the layout, which must stay free of request-time state):

- domain id: `3191a3db-fc9b-4663-ac13-e862015111f3`
- server: `<site origin>/a` from `resolveServerURL()`, not a hard-coded host
- options: `{"ignoreOwnVisits":false,"detailed":true}`
  - `ignoreOwnVisits:false` means ordinary visitors receive no `ackee_ignore`
    cookie.
  - `detailed:true` adds browser, OS, device, screen and language dimensions to
    each record. Without it Ackee's Systems, Devices, Browsers, Sizes and
    Languages panels stay empty.

The component renders only when `NODE_ENV=production`, draft rendering is off,
and the process is not on Vercel. Local development, Live Preview/the CMS and
Vercel previews therefore never post into production statistics. The page
passes its `draft`/`track` flags, so the component itself reads no request-time
API and the public route can stay cacheable.

## What is collected

Ackee keeps one `records` document per page view. In the current configuration
that document contains:

- page URL and referrer, plus Ackee's optional `source` parameter;
- a visitor id derived from IP address and User-Agent with a daily salt (no raw
  IP address or User-Agent is stored), and the record's `created`/`updated`
  timestamps;
- because `detailed` is on: browser name and version, operating system name and
  version, device name and manufacturer, screen width, height and colour depth,
  browser window width and height, and the two-letter language;
- a duration that the tracker updates while the tab is visible.

Ackee does not store a browsing history: when the same visitor returns, the
earlier records for that visitor have their visitor id and detailed dimensions
cleared, so the path of a single visitor cannot be reconstructed. No analytics
cookie is set. A bot User-Agent (`bot|crawler|spider|crawling`) and localhost
are ignored by the tracker.

Detailed tracking sends more personal data than the previous configuration.
Treat that as a deliberate choice: it is needed for the device/browser panels,
and the privacy notice must describe it.

## CV download event

The portfolio's one real conversion is taking the CV. Ackee has one event,
**CV download**, created in the production dashboard. Its id is
`payload-cms/src/utilities/ackeeTracker.ts:ACKEE_CV_DOWNLOAD_EVENT_ID`:

```text
6b8b5a36-fdc0-474f-95a9-e33d3ea53d5a
```

Both anchors in `payload-cms/src/components/CVViewer/index.tsx` — the top
download bar and the fallback link — record an action with `value: 1` and a
`key` naming the format, `DOCX` or `PDF`. The event id is a constant beside the
domain id, not an environment variable, for the same reason as the domain id: a
preview build must never record a conversion into a different domain.

The anchors stay ordinary `href` + `download` links. Only the click handler is
client JavaScript; if the tracker is absent (dev, CI, preview) or throws, the
handler is a no-op and the browser still downloads the file. The tracker is
still production-only.

## Retention

Raw `records` and `actions` documents expire after **12 months** (365 days).
The expiration is enforced by MongoDB TTL indexes on each collection's `created`
field:

```text
records.created: expireAfterSeconds: 31536000
actions.created: expireAfterSeconds: 31536000
```

Ackee computes its charts from these raw documents, so data older than the
window disappears from the dashboard as well. A monthly export is the way to
keep an archive beyond 12 months; do not extend the TTL to keep history in the
live database.

## Dashboard

The dashboard is tailnet-only. The `ackee` container publishes its HTTP port on
the host's tailnet address only, and the reverse proxy has no public proxy host
for it. Open `http://<tailnet-address>:3001` from a device on the tailnet; do
not add a public DNS record or a public proxy host. Ackee's own login still
protects every path.
