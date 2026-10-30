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
own stack at `https://archview.rossmoney.me`. It is protected by OAuth/OIDC, so a
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

MongoDB database name defaults to `rossmoney_me`.

## Go service

ArchView runs from the sibling `archview` repo as its own stack; it is not part of
this Compose project. The deployed instance at `https://archview.rossmoney.me`
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

Portainer stack (CI/production):

```bash
docker compose -f docker-compose.portainer.yml config
```

The CMS (Payload Next app) serves the portfolio and frontend routes directly on port 8082. ArchView is not part of these stacks: it is deployed separately from the `archview` repo at `https://archview.rossmoney.me`, and the CMS reaches it over HTTPS with `ARCHVIEW_URL` and Auth0 client credentials (`ARCHVIEW_CLIENT_ID`/`ARCHVIEW_CLIENT_SECRET`). `stack.env` is shared by the local and Portainer Compose files.

## Environment file

Create a root `stack.env` file for local Compose with these values:

```ini
MONGODB_URI=mongodb://mongo:27017/rossmoney_me
PAYLOAD_SECRET=rossmoney_payload_secret_key_change_me
SERVER_URL=https://www.rossmoney.me
PAYLOAD_SEED=true
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=your-recaptcha-site-key
RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key

# ArchView lives in its own stack at https://archview.rossmoney.me and accepts
# Auth0 client-credentials tokens (no static API keys). At seed time these values
# also create the default "Production" source; ARCHVIEW_URL is the bootstrap
# fallback until a default source exists.
ARCHVIEW_URL=https://archview.rossmoney.me
ARCHVIEW_CLIENT_ID=cms
ARCHVIEW_CLIENT_SECRET=your-archview-client-secret
ARCHVIEW_TOKEN_URL=https://your-tenant.auth0.com/oauth/token
ARCHVIEW_AUDIENCE=https://archview.rossmoney.me/api
ARCHVIEW_SCOPE=archview:read
# 32 random bytes, base64 (`openssl rand -base64 32`); encrypts secrets in the
# ArchView sources collection.
ARCHVIEW_SECRET_KEY=your-archview-secret-key
```

The first block is for the CMS. `ARCHVIEW_URL` is the public ArchView deployment and the bootstrap fallback for pages until a default source exists; the seed turns it into the default **Production** source when the credentials below are present. `ARCHVIEW_CLIENT_ID` and `ARCHVIEW_CLIENT_SECRET` are the `cms` client registered with Auth0, `ARCHVIEW_TOKEN_URL` is the tenant's token endpoint, `ARCHVIEW_AUDIENCE` is the ArchView API identifier that Auth0 requires (defaulting to `https://archview.rossmoney.me/api`), and `ARCHVIEW_SCOPE` defaults to `archview:read`. Without them the architecture panels fall back to their degraded state. `ARCHVIEW_SECRET_KEY` encrypts the client secrets stored in the ArchView sources collection; generate it with `openssl rand -base64 32`. The CMS reads the public reCAPTCHA site key at runtime, while its secret key remains server-side. The Docker API proxy variables this file used to carry now belong to the ArchView stack.

## Seeding ArchView sources

The seed endpoint and the startup seed both create ArchView sources idempotently,
matching on origin so reruns do not duplicate rows or overwrite admin edits:

- **Production** — `isDefault: true`, built from `ARCHVIEW_URL`'s origin,
  `ARCHVIEW_AUDIENCE`, `ARCHVIEW_TOKEN_URL`, `ARCHVIEW_CLIENT_ID` and
  `ARCHVIEW_CLIENT_SECRET` at seed time. The secret is encrypted by the
  collection hook; it is never written into source code. The row is skipped
  unless the origin, token URL, client ID, client secret and
  `ARCHVIEW_SECRET_KEY` are all set, so a local seed without Auth0 still works.
- **Vortexservers** — `https://archview.vortexservers.co.uk`, audience
  `https://archview.vortexservers.co.uk/api`, scope `archview:read`, using the
  same `ARCHVIEW_TOKEN_URL`. It has no client credentials, so it stays anonymous
  until someone enters them in the admin. It is skipped when the token URL is
  unset.

No secret literals live in the seed; the production secret is read from the
environment only at seed time.

### Media storage

Media uploads are stored on the deployment's local filesystem by default. On Vercel that filesystem is ephemeral, so set `BLOB_READ_WRITE_TOKEN` (created by Vercel when Blob storage is added to the project) to store media in Vercel Blob instead.

The variable is optional. When it is absent, the CMS keeps writing uploads to `payload-cms/public/media` and builds/tests do not need any Vercel credentials. The self-hosted Portainer stack (`www.rossmoney.me`) must leave it unset so it keeps using its `payload-media` volume.

## Portainer webhook

Set a repository secret named `PORTAINER_WEBHOOK_URL` to let GitHub Actions redeploy the Portainer stack after publishing images.

GitHub Actions only triggers the existing Portainer webhook; its HTTP response means the request was accepted, not that deployment completed. It rejects HTTP 409 and does not connect to the deployment host. A host-local systemd worker polls Portainer's read-only stack API and runs cleanup only when it observes a new `Deploying` → `Active` status sequence. Portainer's `Active` status confirms the deployment operation completed without error; it does not guarantee application-level health.

An administrator must install Python 3 and the Docker CLI on the deployment host. Install the worker and service unit as root-owned, non-writable files, then create the root-only configuration and state directories:

```sh
sudo install -d -o root -g root -m 0755 /opt/rossmoney-image-prune
sudo install -o root -g root -m 0644 deploy/portainer_image_prune.py /opt/rossmoney-image-prune/portainer_image_prune.py
sudo install -o root -g root -m 0644 'deploy/rossmoney-image-prune@.service' /etc/systemd/system/rossmoney-image-prune@.service
sudo install -d -o root -g root -m 0700 /etc/rossmoney-image-prune
sudo install -d -o root -g root -m 0700 /var/lib/rossmoney-image-prune
```

Create one root-owned, mode-`0600` environment file per Portainer stack (`/etc/rossmoney-image-prune/production.env` and `development.env`) with:

```ini
PORTAINER_API_URL=https://portainer.example
PORTAINER_API_TOKEN=replace-with-a-read-only-token
PORTAINER_STACK_ID=123
PORTAINER_POLL_INTERVAL_SECONDS=15
```

Use an HTTPS Portainer URL and a dedicated API token whose account has read-only access to the Docker environment containing the corresponding stack. The token stays on the host; no Portainer API credentials or host access credentials are required in GitHub Actions. Enable one service instance per configured stack:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now rossmoney-image-prune@production.service
sudo systemctl enable --now rossmoney-image-prune@development.service
```

The service runs locally as root because access to the Docker daemon is effectively root-equivalent. It exposes no listener, only makes outbound HTTPS requests to Portainer and uses the local Docker CLI. Its systemd sandbox limits filesystem writes to the state directory. On first start it records the currently observed deployment as a baseline without pruning; install and start it before expecting cleanup after a deployment. Portainer deployment event times have second-level precision, so an event that cannot be distinguished from the last processed success is skipped rather than treated as confirmed. Failed prune attempts are logged and retried on the next poll. The only Docker operation is `docker image prune -f`; tagged images, containers, volumes, and networks are not pruned.

## Notes

The CMS (Payload Next app) now serves the frontend and pages directly. The telemetry/architecture API is a separate Go service deployed at `https://archview.rossmoney.me` behind OAuth login; the CMS reads it server-side with an Auth0 access token from its own client credentials.

## Dependency updates and audit

Renovate opens grouped dependency PRs, and a CI workflow fails on high or
critical advisories in production dependencies. The rules, the exact audit
command, and the process for accepting a known-unfixable advisory are documented
in [`DEPENDENCY-UPDATES.md`](./DEPENDENCY-UPDATES.md).

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

### De-duplicating projects and experience

Two deployments sharing one database can each seed their own copy of the
default `projects` and `experience` rows. The site de-duplicates those
collections at read time, so duplicates never render, but the extra database
rows remain until they are removed.

The helper uses Payload's local API, only touches `projects` and `experience`,
and keeps the row the site would render: the lowest numeric `order`, with the
oldest `createdAt` as a tie-break. It defaults to a dry run and prints every row
it would delete before touching anything:

```bash
pnpm --filter payload-cms run dedupe:collections
pnpm --filter payload-cms run dedupe:collections -- --apply
```

Set `MONGODB_URI`/`DATABASE_URL` and `PAYLOAD_SECRET` first, and take a backup
before running it against a deployed database.

## CV Viewer

The site now renders the DOCX CV in-browser using mammoth.js. The viewer inserts the converted HTML and applies light normalization for two-column blocks so content stacks cleanly on narrow viewports. A download link for the original DOCX is shown at the top-right of the viewer on desktop (falls back to an inline link on mobile).

If you prefer server-side conversion (avoid bundling mammoth in the browser), the server can convert the DOCX to HTML and serve it pre-rendered — ask and I will add a server endpoint.

## ArchView / telemetry

ArchView is deployed separately at `https://archview.rossmoney.me`, where the
login is handled by the service's own OAuth/OIDC flow. The CMS obtains a
short-lived Auth0 token with the `client_credentials` grant and passes it as a
bearer token on its server-side calls.

- The ArchView telemetry service (the Go project) now filters out exited containers and anonymous/digest-only images from snapshots returned to the frontend. This keeps the UI focused on active services and human-readable images.
- Project-scoped image selection was improved so images referenced by project containers (including different tags) are included rather than being deduped by name alone.

When troubleshooting missing images or unexpected filtering, request the `/api/architecture?project=...` JSON snapshot so we can inspect the raw payload.
