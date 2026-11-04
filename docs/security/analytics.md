# Analytics ingestion (Ackee)

Ackee runs on `rossmoney` as the `ackee` and `ackee-mongo` containers, on the
same Docker network as the CMS. The CMS reaches the app directly at
`http://ackee:3000`; the dashboard is not published on a host port.

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
- options: `{"ignoreOwnVisits":false}`, so ordinary visitors receive no
  `ackee_ignore` cookie

The component renders only when `NODE_ENV=production`, draft rendering is off,
and the process is not on Vercel. Local development, Live Preview/the CMS and
Vercel previews therefore never post into production statistics. The page
passes its `draft`/`track` flags, so the component itself reads no request-time
API and the public route can stay cacheable.

## Dashboard

The Ackee dashboard is tailnet-only at `http://100.112.86.31:3001`. Use it from
a device on the tailnet; do not add a public DNS record or certificate for it.
The public rewrite exists for tracker and collection traffic, and Ackee's own
login still protects its other paths.
