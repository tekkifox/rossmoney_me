# DevOps Portfolio

This workspace contains a static portfolio site for a developer with a DevOps focus.

## What’s included

- A bold single-page portfolio with hero, work, experience, and contact sections.
- A dedicated `/travelling` page with a travel project summary and architecture snapshot.
- A live architecture panel that fetches JSON from a host-provided Go service.
- A Payload CMS admin at `/admin/` backed by MongoDB for editable page content.
- A fallback rendering path so the page still shows useful state when the feed is unavailable.

## Architecture feed

The telemetry service lives in the sibling `archview` repo and is deployed as its
own stack at `https://archview.example.com`. It is protected by OAuth/OIDC, so a
person opening that hostname is sent through the identity provider's login before
it serves a snapshot. There are no static API keys: the CMS never calls it
anonymously. Every ArchView deployment the CMS may use is a row in the admin's
**ArchView → ArchView sources** collection, including the primary one. Server-side
requests go through the CMS proxy `GET /api/architecture`, which exchanges the
selected row's Auth0 client credentials for a short-lived bearer token
(`client_credentials` grant with its `tokenUrl`, `audience` and `scope`).

A page chooses its source in this order: the page's **ArchView source** relation,
then its legacy **ArchView URL** text, then the collection's **default** row, then
the `ARCHVIEW_URL` bootstrap value. A page that names no source therefore reads
the default row. `ARCHVIEW_URL` is only a bootstrap fallback, used until a default
source exists (the seed creates one from the environment when credentials are
present), and it still works for local development against `AUTH_MODE=none`.

Browsers always call the same-origin proxy, since ArchView requires a session the
visitor does not have. The page passes either `?source=<origin>` for its chosen
row (or legacy URL text) or a source ID; the proxy accepts both and resolves them
through the same enabled-row lookup. The token is only ever sent to that source's
own origin, and `source` is stripped before forwarding.

Origins that have no collection row can still be listed in
`ARCHVIEW_ALLOWED_SOURCES` (comma-separated HTTPS origins). Those instances are
anonymous by design: the variable admits them, but no credential is attached.
Anything that is neither an enabled source nor allowlisted falls back to
`ARCHVIEW_URL`.

`ARCHVIEW_TIMEOUT_MS` sets the upstream fetch budget in milliseconds for
`/api/architecture` (default 15000, max 60000; invalid values fall back to the
default).

A source's client secret is optional and encrypted at rest in MongoDB with
AES-256-GCM (a random 12-byte IV per value) using `ARCHVIEW_SECRET_KEY`.
Generate the key once with `openssl rand -base64 32` and set it before adding
secrets; without it the collection refuses to store or read secrets instead of
writing plaintext, and changing it makes existing stored secrets unreadable. A
row with no client ID and secret stays anonymous until an editor fills them in.

The travelling page requests `?project=image-mosaic`; the game-servers page
requests `?project=vortexservers_co_uk`.

The frontend is tolerant of a few common field names, including:

- `title`, `name`, `service`, `system`
- `description`, `summary`, `notes`
- `status`, `health`, `state`
- `services`, `components`, `apps`
- `nodes`, `hosts`, `instances`
- `regions`, `availabilityZones`, `zones`

## Running it

This project is plain HTML, CSS, and JavaScript, so you can serve it from any static host and point it at the API container directly.

The Go API sends permissive CORS headers, so the site can fetch it across origins during local development.

## Workspace and tasks

The repository is a pnpm workspace driven by Turborepo. `payload-cms` is the only
workspace package; the lockfile, `pnpm-workspace.yaml`, root `package.json` and
`turbo.json` live at the repository root.

```bash
pnpm install --frozen-lockfile
pnpm --filter payload-cms dev
pnpm turbo run build --filter=payload-cms
pnpm turbo run lint --filter=payload-cms
pnpm turbo run test:int --filter=payload-cms
```

`pnpm dev` starts the same dev server through Turbo, and
`pnpm --filter payload-cms run <script>` runs any package script directly.

## CMS

The content editor stores documents in MongoDB through the `cms` service.

The CMS API exposes:

- `GET /api/cms/site`
- `GET /api/cms/collections/:collection`
- `GET /api/cms/collections/:collection/:slug`
- `PUT /api/cms/collections/:collection/:slug`
- `DELETE /api/cms/collections/:collection/:slug`

Open `/admin/` to manage the home page, projects, experience entries, and contact block.

Each project has an optional **URL** field. Set it to an absolute `http://` or
`https://` address to make the whole **Selected work** card on the homepage link
there (opening in a new tab); leave it empty and the card renders without a link.

### Bot settings

The `bot-settings` global (Operations → Bot settings) configures the notification
bot's targets, sources and model. Tick a target's **Report on all hosts** to let
it report on every host the bot may reach; leave it unticked and list hostnames
under **Hosts** to restrict the target to them.

MongoDB database name defaults to `rossmoney_me`.

## Bot settings

The notification agent reads its configuration from `GET /api/bot-settings`
(authenticated with a Payload API key), which returns `version`, `targets`,
`sources` and `hosts`. `hosts` is built from the **ArchView → ArchView sources**
collection — one `{ "name": "<hostname>", "sshPort": <port> }` entry per enabled
source, sorted by name — and the agent uses it as its host-to-SSH-port map. Set
the **SSH port** field on a source to the port that host answers on; an empty
field reads as the conventional SSH port.

## Go service

ArchView runs from the sibling `archview` repo as its own stack; it is not part of
this Compose project. The deployed instance at `https://archview.example.com`
requires an OAuth login and exposes:

- `/healthz`
- `/readyz`
- `/api/architecture`
- `/api/overview`
- `/api/docker`
- `/api/system`

The CMS reaches the API server-side only, through its own `/api/architecture`
proxy, using an Auth0 access token from its own client credentials.

Local (development) — exposes the CMS on port 8082:

```bash
docker compose -f docker-compose.yml up --build
```

Production (CI):

```bash
docker compose -f docker-compose.deploy.yml config
```

Note: `docker-compose.deploy.yml` mirrors the deployed stack and is kept here for review
and `docker compose config` validation. The stack the host actually runs is declared in
the fleet's `infrastructure-as-code` repository and applied by Ansible, not from this
repository; `cms-publish.yml` only asks the fleet to pull and recreate it. The older
`docker-compose.portainer.yml` is stale (it still defines a `mongo` service,
`ports: 8082:8082` and a `mongo-data` volume) and must not be used for deployment.

The CMS (Payload Next app) serves the portfolio and frontend routes directly on port 8082. ArchView is not part of these stacks: it is deployed separately from the `archview` repo at `https://archview.example.com`, and the CMS reaches it over HTTPS with `ARCHVIEW_URL` and Auth0 client credentials (`ARCHVIEW_CLIENT_ID`/`ARCHVIEW_CLIENT_SECRET`). `stack.env` is shared by the local and deploy Compose files.

## Environment file

Create a root `stack.env` file for local Compose with these values:

```ini
MONGODB_URI=mongodb://mongo:27017/rossmoney_me
PAYLOAD_SECRET=rossmoney_payload_secret_key_change_me
SERVER_URL=https://www.example.com
PAYLOAD_SEED=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-turnstile-site-key
TURNSTILE_SECRET_KEY=your-turnstile-secret-key

# ArchView lives in its own stack at https://archview.example.com and accepts
# Auth0 client-credentials tokens (no static API keys). At seed time these values
# also create the default "Production" source; ARCHVIEW_URL is the bootstrap
# fallback until a default source exists.
ARCHVIEW_URL=https://archview.example.com
ARCHVIEW_CLIENT_ID=cms
ARCHVIEW_CLIENT_SECRET=your-archview-client-secret
ARCHVIEW_TOKEN_URL=https://your-tenant.auth0.com/oauth/token
ARCHVIEW_AUDIENCE=https://archview.example.com/api
ARCHVIEW_SCOPE=archview:read
# 32 random bytes, base64 (`openssl rand -base64 32`); encrypts secrets in the
# ArchView sources collection.
ARCHVIEW_SECRET_KEY=your-archview-secret-key

# Host sampling runs on exactly one deployment. Give each deployment its own
# short HOST_SAMPLER_INSTANCE and point HOST_SAMPLER_OWNER at the one allowed
# to sample. An owner set without an instance means nobody samples.
# HOST_SAMPLER=off disables sampling everywhere; HOST_SAMPLER=on forces it,
# Vercel included. With neither set, sampling keeps the old behaviour.
HOST_SAMPLER_INSTANCE=portainer
HOST_SAMPLER_OWNER=portainer
```

The first block is for the CMS. `ARCHVIEW_URL` is the public ArchView deployment and the bootstrap fallback for pages until a default source exists; the seed turns it into the default **Production** source when the credentials below are present. `ARCHVIEW_CLIENT_ID` and `ARCHVIEW_CLIENT_SECRET` are the `cms` client registered with Auth0, `ARCHVIEW_TOKEN_URL` is the tenant's token endpoint, `ARCHVIEW_AUDIENCE` is the ArchView API identifier that Auth0 requires (defaulting to `https://archview.example.com/api`), and `ARCHVIEW_SCOPE` defaults to `archview:read`. Without them the architecture panels fall back to their degraded state. `ARCHVIEW_SECRET_KEY` encrypts the client secrets stored in the ArchView sources collection; generate it with `openssl rand -base64 32`. The CMS reads the public Turnstile site key at runtime, while its secret key remains server-side. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` come from a Turnstile widget created in the Cloudflare dashboard (free plan, no DNS change). Without them the form still works under `next dev` and on Vercel preview deployments, with a warning in the server log; a production deployment rejects contact submissions with a readable configuration error rather than silently skipping verification. The Docker API proxy variables this file used to carry now belong to the ArchView stack.

### Host sampling

The host sampler is the only writer of `host-samples`. It records ArchView
telemetry for every enabled source once every three minutes on a timer, so it
must run on exactly one deployment. The timer is started by
`src/instrumentation.ts` when the server process starts, never from Payload's
`onInit`; that keeps every tick outside any request or render context (see the
comment in `src/utilities/hostSamplerSchedule.ts`). Browsing a page adds no
samples: the `/api/architecture` proxy only fetches, caches and redacts. Name each
deployment with `HOST_SAMPLER_INSTANCE` and name the one allowed to sample with
`HOST_SAMPLER_OWNER`. The decision is made in this order:

1. `HOST_SAMPLER=off` never samples, whatever else is set.
2. If `HOST_SAMPLER_OWNER` is set, only the deployment whose
   `HOST_SAMPLER_INSTANCE` equals it (trimmed, case-insensitive) samples. An
   owner with no instance means nobody samples.
3. `HOST_SAMPLER=on` samples, Vercel included.
4. Otherwise sampling follows the old behaviour: on unless `VERCEL` is set.

Empty values count as unset, and a deployment that sets neither new variable
behaves exactly as before. The chosen deployment logs its instance, the owner
and whether it will sample once at startup.

For example, to keep sampling on the host: set
`HOST_SAMPLER_OWNER=portainer` on both deployments,
`HOST_SAMPLER_INSTANCE=portainer` on the Portainer host and
`HOST_SAMPLER_INSTANCE=vercel` on Vercel. Only the host samples. Change the
owner to `vercel` on both deployments to move sampling to Vercel.

## Seeding ArchView sources

The seed endpoint and the startup seed both create ArchView sources idempotently,
matching on origin so reruns do not duplicate rows or overwrite admin edits:

- **Production** — `isDefault: true`, built from `ARCHVIEW_URL`'s origin,
  `ARCHVIEW_AUDIENCE`, `ARCHVIEW_TOKEN_URL`, `ARCHVIEW_CLIENT_ID` and
  `ARCHVIEW_CLIENT_SECRET` at seed time. The secret is encrypted by the
  collection hook; it is never written into source code. The row is skipped
  unless the origin, token URL, client ID, client secret and
  `ARCHVIEW_SECRET_KEY` are all set, so a local seed without Auth0 still works.
- **Vortexservers** — `https://archview.example.org`, audience
  `https://archview.example.org/api`, scope `archview:read`, using the
  same `ARCHVIEW_TOKEN_URL`. It has no client credentials, so it stays anonymous
  until someone enters them in the admin. It is skipped when the token URL is
  unset.

No secret literals live in the seed; the production secret is read from the
environment only at seed time.

### Startup seeding and the optional dev admin

Every CMS startup runs the same idempotent seed: the header, the default pages
(including `/map`), the sample CV, projects, experience, ArchView sources and
the bot settings are created when missing, and missing pages are added on later
starts. `PAYLOAD_SEED=true` still forces the default documents to be rewritten,
so an editor's changes are only replaced when that flag is set. Uploads may live
on local disk or in Vercel Blob: `BLOB_READ_WRITE_TOKEN` decides where media is
stored, never whether seeding runs.

Two optional variables create a dev admin on startup:

```ini
PAYLOAD_SEED_ADMIN_EMAIL=dev@example.com
PAYLOAD_SEED_ADMIN_PASSWORD=replace-with-a-password
```

The user is created only when both variables are set and no user with that email
exists. An existing user is never modified: the password is never reset and no
user is ever deleted. Set neither variable to keep the previous behaviour. The
password is never written to the logs.

### Media storage

Media uploads are stored on the deployment's local filesystem by default. On Vercel that filesystem is ephemeral, so set `BLOB_READ_WRITE_TOKEN` (created by Vercel when Blob storage is added to the project) to store media in Vercel Blob instead.

The variable is optional. When it is absent, the CMS keeps writing uploads to `payload-cms/public/media` and builds/tests do not need any Vercel credentials. The self-hosted Portainer stack (`www.example.com`) must leave it unset so it keeps using its `payload-media` volume.

## Deploy

Publishing the production image does not deploy it by talking to Portainer. `cms-publish.yml`
ends by joining the tailnet and running, over SSH, a single `fleet-deploy` command on the
fleet's `mgmt` host. The deploy seat there pulls and recreates the named stack on the named
host, and refuses a stack its host does not declare, so a stack has to exist in the fleet
inventory before this job can deploy it.

The job does not call the fleet's reusable deploy workflow: that workflow lives in a private
repository, and GitHub refuses to load a workflow in a public repository that calls a
reusable workflow in a private one, so the call would fail before any job ran. The steps
here are a small copy of it — a tailnet join and one SSH command — and the seat does the
validation.

The job needs three repository secrets:

- `TS_AUTHKEY` — the ephemeral Tailscale auth key for the runner;
- `DEPLOY_SSH_KEY` — the private half of the deploy-only key installed on `mgmt`;
- `DEPLOY_SEAT_HOST` — the seat's address, kept out of this repository because it is
  public and must not publish a real hostname.

Until `DEPLOY_SSH_KEY` exists in this repository the deploy step fails; the image build and
manifest publish still succeed. The job only runs on `main`, so the first push to `main`
after the key is added is the real proof that the deploy works.

Dangling image cleanup is handled by watchtower on the host, with
`WATCHTOWER_CLEANUP=true` on a weekly schedule. Nothing in this repository prunes
Docker images, and no worker or service unit needs installing for it.

## Notes

The CMS (Payload Next app) now serves the frontend and pages directly. The telemetry/architecture API is a separate Go service deployed at `https://archview.example.com` behind OAuth login; the CMS reads it server-side with an Auth0 access token from its own client credentials.

## Dependency updates and audit

Renovate opens grouped dependency PRs, and a CI workflow fails on high or
critical advisories in production dependencies. The rules, the exact audit
command, and the process for accepting a known-unfixable advisory are documented
in [`DEPENDENCY-UPDATES.md`](./DEPENDENCY-UPDATES.md).

## Page caching and revalidation

Public HTML is cacheable. The `[slug]` route exports
`revalidate = 300` (five minutes) instead of `force-dynamic`, and the homepage
is the `pages` document with slug `home`, served by `next.config.ts` through a
`/` → `/home` rewrite so it uses the same on-demand route. A production build
sets `Cache-Control: s-maxage=…, stale-while-revalidate=…` on an ordinary page;
it no longer sends `private, no-store`. The header reports the shortest window
among the page and its nested data caches: 45 s for a page that embeds an
ArchView snapshot, 60 s for a page that only reads a global, and never more than
the route's 300 s. The build itself uses Payload's no-op database adapter, so
pages are generated from the live database on first request rather than frozen
at build time.

Draft preview is split from that cache. `src/proxy.ts` looks for Next.js' draft
cookie (`__prerender_bypass`); when it is present the request is rewritten
(same URL, same query) to the dynamic renderer under `/next/draft/`, which does
read `draftMode()` and renders the draft document. The preview response keeps
`private, no-store`. Ordinary visitors never reach that route, and the public
layout does not read request-time state. The admin bar learns that it should
offer "Exit preview mode" from a readable companion cookie set by
`/next/preview`.

An editor sees a change immediately because these mutations invalidate the
cached HTML as well as waiting for the window:

- saving, unpublishing or deleting a page (`Pages` after-change/after-delete
  hooks) revalidates `/home` plus `/` for the homepage, or the page's own path,
  and the page sitemap;
- changing an ArchView source revalidates every public page (the architecture
  panel is rendered into the HTML) and the shared snapshot cache;
- saving the header or footer settings revalidates the root layout, and through
  it every public page.

The revalidation keys live in
`payload-cms/src/utilities/revalidatePublicPages.ts`; keep the literal
`revalidate = 300` in the page route in step with
`PUBLIC_PAGE_REVALIDATE_SECONDS` there.

Cached public documents cannot carry a per-request CSP nonce (the cached HTML
would not match the response header), so they use the documented static script
allowlist. Dynamic previews, the admin and the API keep the nonce policy. See
[`docs/security/csp.md`](./docs/security/csp.md#prerendering-and-nonces).

## Robots and SEO

Robots are generated during the site build by next-sitemap (see `payload-cms/next-sitemap.config.cjs`). By default the generator blocks admin and API endpoints and allows public media. If you prefer a static file, copy `payload-cms/public/robots-template.txt` to `payload-cms/public/robots.txt` and update the Sitemap line with your production domain.

During builds the sitemap and robots.txt are produced automatically when `next-sitemap` runs as part of `pnpm build`.

If you want to generate a static sitemap and robots.txt locally (useful for testing static deployments), run the helper script included in the project. From the repo root:

```bash
cd payload-cms
pnpm install
pnpm generate:sitemap
```

This writes `payload-cms/public/sitemap.xml` and `payload-cms/public/robots.txt` based on the seeded pages in `payload-cms/src/endpoints/seed`. These files are ignored by git by default (environment-specific), so copy or publish them as needed for your deployment.

### Unpublishing the retired pages

The `commits`, `experience-page`, `work` and `architecture` pages no longer
render a public template and nothing reads their content. Fresh databases do not
seed them at all; this helper is only for a database that already contains them
from an earlier seed and still has them published.

The helper uses Payload's local API and only changes `_status` to `draft`. It
never deletes documents and defaults to a dry run:

```bash
pnpm --filter payload-cms run unpublish:retired-pages
pnpm --filter payload-cms run unpublish:retired-pages -- --apply
```

Set `MONGODB_URI`/`DATABASE_URL` and `PAYLOAD_SECRET` first, and take a backup
before running it against a deployed database.

## CV Viewer

The site now renders the DOCX CV in-browser using mammoth.js. The viewer inserts the converted HTML and applies light normalization for two-column blocks so content stacks cleanly on narrow viewports. A download link for the original DOCX is shown at the top-right of the viewer on desktop (falls back to an inline link on mobile).

If you prefer server-side conversion (avoid bundling mammoth in the browser), the server can convert the DOCX to HTML and serve it pre-rendered — ask and I will add a server endpoint.

## ArchView / telemetry

ArchView is deployed separately at `https://archview.example.com`, where the
login is handled by the service's own OAuth/OIDC flow. The CMS obtains a
short-lived Auth0 token with the `client_credentials` grant and passes it as a
bearer token on its server-side calls.

- The ArchView telemetry service (the Go project) now filters out exited containers and anonymous/digest-only images from snapshots returned to the frontend. This keeps the UI focused on active services and human-readable images.
- Project-scoped image selection was improved so images referenced by project containers (including different tags) are included rather than being deduped by name alone.

When troubleshooting missing images or unexpected filtering, request the `/api/architecture?project=...` JSON snapshot so we can inspect the raw payload.
