# Content-Security-Policy for `payload-cms`

**Status:** enforced on every production response.  
**Date:** 2026-10-26.  
**Scope:** `www.rossmoney.me` (Portainer/openresty), `rossmoney-me.vercel.app`
(Vercel production), `dev.rossmoney.me` (Vercel preview), and local
`next start`.

The audit that motivated this policy is in
[`audit-2026-10-26.md`](./audit-2026-10-26.md). This file is the maintenance
record for the policy itself: every allowed source has a reason, and the reasons
are meant to survive the next edit.

## Where the header comes from

`src/proxy.ts` (the Next 16 replacement for `middleware.ts`) builds the policy
per request and does two things with it:

1. puts it on the response as `Content-Security-Policy`;
2. puts the same value on the **forwarded request** header, because Next.js only
   adds the nonce to its own `<script>` tags when it can read one from the
   request's CSP header (`getScriptNonceFromHeader` in `next/dist`).

`next.config.ts` deliberately no longer emits a CSP. Two policies combine by
intersection, so a static `frame-ancestors 'none';` header would have blocked
every nonced script.

The builder is `src/utilities/contentSecurityPolicy.ts`; the unit tests are
`tests/int/content-security-policy.int.spec.ts`.

## Public policy

```text
default-src 'none';
script-src 'nonce-{nonce}' 'strict-dynamic' 'self' https://www.google.com https://www.gstatic.com;
style-src 'self';
style-src-elem 'self';
style-src-attr 'unsafe-inline';
script-src-attr 'none';
img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://www.gstatic.com;
font-src 'self' data:;
connect-src 'self' https://*.public.blob.vercel-storage.com https://archview.vortexservers.co.uk https://www.google.com https://www.gstatic.com;
media-src 'self' blob:;
worker-src 'self' blob:;
manifest-src 'self';
frame-src https://www.google.com;
frame-ancestors 'none';
object-src 'none';
base-uri 'none';
form-action 'self'
```

On HTTPS responses `upgrade-insecure-requests` is appended. It is omitted on
local HTTP so `next start` on `http://localhost` still works.

## Admin policy

Same as the public policy, except:

```text
script-src ... https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
style-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
img-src ... https://www.gravatar.com https://secure.gravatar.com https://cdn.jsdelivr.net;
font-src 'self' data: https://cdn.jsdelivr.net;
worker-src 'self' blob: https://cdn.jsdelivr.net;
connect-src ... https://cdn.jsdelivr.net;
frame-src 'none'
```

The admin does not get the Google reCAPTCHA sources and public pages do not get
Gravatar/jsDelivr.

## Why a nonce, not a static allowlist

A static allowlist would have to include `'unsafe-inline'` for `script-src`,
because Next.js emits inline RSC bootstrap scripts plus the theme-init script on
every page. That would remove most of the protection the policy is for. Hashes
are not practical either: the RSC payload changes with the build and with the
route.

A nonce requires the response to be rendered per request. **This app already
renders every public page that way.** `src/app/(frontend)/[slug]/page.tsx` has
`export const dynamic = 'force-dynamic'`, and the production build prerenders no
`[slug]` pages because `generateStaticParams()` returns `[]` without a database
during the build. The build output is `ƒ /` and an on-demand `● /[slug]`; two
requests to the same page receive different nonces. No static optimisation was
given up for this change.

If a future change starts prerendering public pages, the nonce would be baked
into the HTML and would not match the per-request header. The guard is the
`force-dynamic` export already on `[slug]`; do not remove it without switching
the policy to hashes or a static allowlist.

## Enforcing from day one

The policy is enforced, not `Report-Only`. The browser checks in the audit ran
against a production build and finished with zero `securitypolicyviolation`
events on the home page, the CV page (DOCX viewer), a page with an image, the
contact page (including the reCAPTCHA flow), `/admin` from first paint through
login through editing/saving, and the 404 page. The admin save was verified by
reading the changed field back, and an upload returned `201`.

A report-only period would have been appropriate if the app were larger or if
we could not exercise the admin. Here the app is small, the surfaces are known,
and the violations found during the build were all fixed (see
[the audit's before/after list](./audit-2026-10-26.md#csp-before-and-after)).
Shipping report-only after that would only delay protection.

## Directive and source justifications

- **`default-src 'none'`.** Everything not named below is denied. This is the
  baseline; new features must add the narrowest source that works.
- **`script-src` nonce + `'strict-dynamic'` + `'self'`.** The nonce covers
  Next.js's inline RSC/theme scripts and every `<script src>` that Next renders.
  `'strict-dynamic'` lets the trusted bootstrap insert the chunks that
  client-side navigation needs, and lets the analytics and reCAPTCHA packages
  insert their scripts without nonces. `'self'` is kept for browsers that do
  not implement `strict-dynamic`. Google/gstatic host sources are the CSP2
  fallback for reCAPTCHA; CSP3 browsers ignore host sources in a
  `strict-dynamic` policy and rely on the trusted insertion instead.
- **`style-src 'self'` + `style-src-elem 'self'` + `style-src-attr
  'unsafe-inline'`.** Public pages use React `style` attributes (inline style
  attributes) but no inline `<style>` elements, so attributes are allowed and
  stylesheet text is not. The admin needs `style-src 'unsafe-inline'` because
  Payload injects style elements and attributes throughout the panel; there is
  no nonce/hash mechanism for style attributes, so this is a documented
  compromise. `cdn.jsdelivr.net` is Monaco's stylesheet.
- **`script-src-attr 'none'`.** React does not use inline event-handler
  attributes. Blocking them closes the usual reason to want
  `script-src 'unsafe-inline'`.
- **`img-src 'self' data: blob: https://*.public.blob.vercel-storage.com`.** Self
  covers Payload media and the image optimiser; `data:` covers the blur
  placeholder and DOCX images; `blob:` covers admin previews; the Blob host is
  the Vercel storage adapter. `gstatic` is the reCAPTCHA badge image; Gravatar
  and jsDelivr codicons are admin-only.
- **`font-src 'self' data:`.** Geist is self-hosted in `/_next/static/media`.
  The admin's Monaco codicon font comes from jsDelivr.
- **`connect-src 'self'`.** The public site fetches its own API, the CV DOCX,
  the architecture API and same-origin Vercel Analytics beacons. The Blob host
  is the direct-to-blob upload path. `archview.vortexservers.co.uk` is the
  browser-side architecture snapshot used by the gameservers page; the list is
  explicit rather than `https:` so a compromised page cannot exfiltrate to an
  arbitrary HTTPS origin. `ARCHVIEW_URL`/`ARCHVIEW_HOST` can add public HTTPS
  origins without a code change; internal HTTP hosts are filtered out. Google
  and gstatic are reCAPTCHA's token/challenge endpoints.
- **`media-src 'self' blob:`.** Uploaded audio/video and admin previews.
- **`worker-src 'self' blob:`.** Monaco's workers; jsDelivr is the admin
  fallback. reCAPTCHA's worker runs inside its own frame.
- **`manifest-src 'self'`.** `site.webmanifest`.
- **`frame-src https://www.google.com`.** reCAPTCHA v3's invisible anchor /
  bframe. The admin gets `'none'`.
- **`frame-ancestors 'none'`.** Nobody may frame the site. This is the same
  clickjacking protection the app had via `X-Frame-Options: DENY`, now also in
  CSP. It intentionally keeps Payload's live-preview iframe blocked (that was
  already the case before this change).
- **`object-src 'none'`, `base-uri 'none'`, `form-action 'self'`.** No plugins,
  no `<base>` rewriting, and forms may only submit to this origin. Payload's
  admin forms are same-origin; the public contact form uses `fetch` to
  `/api/form-submissions`.

## Development

`next dev` uses `eval` and a WebSocket for HMR, so the strict policy is skipped
when `NODE_ENV !== 'production'`. `next start`, Vercel and the Portainer image
all run with `NODE_ENV=production`, so the hosted surfaces are covered. The
Playwright e2e suite starts `pnpm dev` and is therefore unaffected; the CSP
browser evidence was collected against `next start` (a production build).

## Maintenance checklist

When a new third-party script, image, font, frame or API is added:

1. add the narrowest origin to the right directive in
   `contentSecurityPolicy.ts` (admin-only sources go behind `isAdmin`);
2. add or update a unit test;
3. run the browser checks on a production build (`next build && next start`)
   with a `securitypolicyviolation` listener and confirm zero events;
4. update this file with why the source is needed.

Do not add `'unsafe-inline'` to `script-src`, `'unsafe-eval'`, a bare `https:`,
or a `*` source. If a dependency needs one of those, fix or replace the
dependency first.
