# AGENTS.md

Operational notes for agents working in this repo. The design system itself is
documented in [`DESIGN.md`](./DESIGN.md); read that before changing anything
visual.

## Build and test

Run from the repo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter payload-cms run dev
pnpm --filter payload-cms run build
pnpm --filter payload-cms run lint
pnpm --filter payload-cms run test:int
pnpm --filter payload-cms run lint:tokens
```

- `test:int` needs a MongoDB URI (`MONGODB_URI`, `DATABASE_URL` or `DEV_MONGO_URI`)
  and runs in a throwaway database on that server, dropped at the end. It never
  touches the database named in the URI.
- `lint` is [oxlint](https://oxc.rs/), configured by `payload-cms/.oxlintrc.json`
  (correctness rules plus react, react-hooks, nextjs, import, promise, vitest
  and jsx-a11y). `lint:fix` applies its safe fixes. ESLint is gone: its
  TypeScript parser cannot load TypeScript 7.
- `test:e2e` needs a running app on `http://localhost:3000` and a database; it
  is not part of `test:int`.
- The build uses Payload's no-op database adapter during the production build,
  so it does not need a live MongoDB.
- No new dependencies are needed for the token guard; it is plain Node.

## Browser smoke and PR screenshots

`.github/workflows/browser-smoke.yml` runs on the self-hosted `paseo` runner
against the VM's shared dev MongoDB instead of starting a MongoDB server of its
own. `DEV_MONGO_URI` is a repository secret containing only the base URI; the
workflow appends a run-scoped database name:

- smoke: `rossmoney_ci_<run-id>_<attempt>`;
- screenshots: `rossmoney_shots_<run-id>_<attempt>`, copied from the seeded
  `rossmoney_dev` database by `payload-cms/scripts/mongo-db.mjs` over the
  project's `mongodb` driver (the paseo VM has no `mongosh`, Docker or MongoDB
  Database Tools). `rossmoney_dev` is only ever read.

Both databases are dropped at the end of the run. `PAYLOAD_SEED=true` makes
`onInit` refresh the default documents on every startup: the per-run databases
are disposable, and this is what makes a pull request that changes a seeded page
show that change in its screenshot. The smoke database starts empty, so it gets
the sample CV. The screenshot database is a copy of the seeded `rossmoney_dev`,
so force-seeding merges the page fields but leaves the real CV upload in place
(`attachSeededCv` only links the sample when the field is empty).
`ACKEE_ENABLED=false` is also set: the `/a` tracker rewrite targets the `ackee`
Docker service, which is not part of this job, so a rendered tracker would leave
a request hanging and stall the page's `load` event.

The two servers must not share a build directory. Next.js keeps its full route
cache inside `distDir`, so a render the smoke server cached against the smoke
database would be served by the screenshot server even though it points at the
copy of `rossmoney_dev`. After the build the workflow copies `payload-cms/.next`
to `payload-cms/.next-screenshots` *before* the smoke run; the screenshot server
starts with `NEXT_DIST_DIR=.next-screenshots` (`SCREENSHOT_DIST_DIR` in
`playwright.screenshots.ts`), so it reads and writes only its own copy.

Before the screenshot server starts, the workflow installs the production media
the copied database references into `payload-cms/public/media`. It uses the
first local directory mirror that exists: `MEDIA_MIRROR` (a repository variable,
when set), then `/home/ross/stacks/rosso-dev-sync/media`, then the older
`/opt/rossmoney-dev-sync/media`. If none exists, it reads the filenames from the
`media` collection of the copied database and downloads them from
`https://www.rossmoney.me/media/`. The installed file count must match the
number of referenced files, so a partial mirror or download fails the job.
Without those files the copied pages point at missing images and the CV seed
hook waits on a fetch that cannot succeed.

Screenshots are captured by `payload-cms/playwright.screenshots.ts` (separate
from `pnpm test:e2e`) after the smoke suite, against the throwaway copy and the
isolated build, with `HOST_SAMPLER=off`. When `/cv` is captured the spec also
reads `/api/pages` from that server and compares the CV download filename with
the media document the database holds, so a stale render from the smoke server
fails the step instead of publishing the wrong image. The default paths are `/`
and `/admin/collections/host-samples`; a manual `workflow_dispatch` can pass a
comma-separated `paths` input. `payload-cms/scripts/publish-screenshots.ts`
checks both the PNGs and the captured page text for secret-shaped material
before uploading to BookStack; a finding fails the job without uploading
anything. Images attach to the page in `BOOKSTACK_SCREENSHOT_PAGE_ID` as
`gallery` images, and one marker comment on the pull request is created or
updated with the image URLs.

```bash
pnpm --filter payload-cms run screenshots
pnpm --filter payload-cms run screenshots:publish
```

## Server URL

Payload builds absolute URLs (media, password resets) from
`payload-cms/src/utilities/serverURL.ts`. Precedence: explicit `SERVER_URL` or
`NEXT_PUBLIC_SERVER_URL`, then `http://localhost:8082` everywhere except Vercel.
On Vercel the value is left unset — `VERCEL_URL` is the deployment's own
protected hostname, not the domain a person browses, so using it pointed the
admin's API requests and every media URL at a foreign origin. Unset keeps the
admin same-origin and media URLs relative; see `src/utilities/adminOrigin.ts`
for why that needs the small `src/proxy.ts` origin normalisation.

## Design-system rules

1. `payload-cms/src/styles/tokens.css` is the **only** place a colour, radius,
   spacing step, font size or shadow may be defined.
2. Components and stylesheets use tokens (`var(--token)`), never raw values.
3. A new colour means a new token first — primitive, then a semantic role.
4. Theme work edits primitives only. If a theme change needs a component edit,
   the token set is wrong.
5. Never add a raw `#hex`, `rgb()`, `rgba()` or `hsl()` outside `tokens.css`.
   `pnpm --dir payload-cms lint:tokens` enforces this; the only exceptions are
   the documented DOCX contract rules listed in `DESIGN.md`.
6. The public site is deliberately light in both OS themes. The dark token
   block exists for fidelity but is overridden by the local palette; do not
   "fix" that without a product decision.

## File map

| File | Responsibility |
| --- | --- |
| `payload-cms/src/styles/tokens.css` | All design values (primitives + semantics) |
| `payload-cms/src/app/(frontend)/globals.css` | Tailwind entry, `@theme` mapping, base and background layers |
| `payload-cms/src/app/(frontend)/local-styles.css` | Public component rules; reads tokens |
| `payload-cms/src/app/(frontend)/layout.tsx` | CSS import order: globals → tokens → local-styles |
| `payload-cms/src/app/api/og/route.tsx` | Dynamic 1200×630 Open Graph card |
| `payload-cms/src/utilities/ogImage.ts` | OG defaults, cache lifetime and URL builder |
| `payload-cms/src/utilities/ogTheme.ts` | OG card's mirror of the rendered token values |
| `payload-cms/public/og-fonts/` | Geist font assets for the OG card |
| `payload-cms/src/collections/ArchviewSnapshots.ts` | Last-known-good ArchView JSON cache (one row per key) |
| `payload-cms/src/utilities/architectureStore.ts` | Snapshot cache key, read, throttled in-place write |
| `payload-cms/tailwind.config.mjs` | Tailwind typography plugin overrides |
| `payload-cms/scripts/check-tokens.mjs` | Raw-colour guard and named exceptions |
| `payload-cms/src/app/(payload)/custom.scss` | Payload admin styling (leave alone) |

The old root `styles.css` duplicate has been removed; do not reintroduce it.

## Page templates

A page's `template` field decides which module in
`src/app/(frontend)/templates/` renders it. Adding a page needs no code change:
choose `Default` to render its title, eyebrow, lead and content blocks, or one
of the named templates. `src/utilities/pageTemplates.ts` is the single mapping;
keep its `PAGE_TEMPLATES` list in step with the template modules.

Pages created before the field existed have no value and fall back to the old
slug chain (`resolvePageTemplate`). Backfill those explicitly with:

```bash
pnpm --filter payload-cms run backfill:page-templates -- --apply
```

The helper is a dry run by default and only fills missing values. `onInit`
applies the same fill-in automatically to older databases; fresh seeds already
store templates. Never overwrite a template an editor has chosen.

## CV page

The CV page renders the media document its `cvFile` upload field points at. A
DOCX or PDF is converted once on upload and the HTML is stored on the media
document, so the viewer needs the populated relation, not a raw id.

`onInit` creates a small sample CV (`CV_SEED_FILENAME` in
`src/endpoints/seed/cv-page.ts`) and links it when the seeded page has no
document, so a fresh dev or CI database renders a CV instead of the "not
available" card. An editor's upload is never replaced, and the full seed
endpoint links the same document when it recreates the page. `renderPage`
resolves an id-only `cvFile` before rendering, so a shallow (depth 0) page still
reaches the viewer populated.

Next.js' full route cache lives inside the build directory, so the CI smoke
server and screenshot server must not share one. The workflow gives the
screenshot server its own copy (`.next-screenshots`), and the screenshot spec
asserts that the captured `/cv` download matches the media document the
screenshot database holds. That check is what catches a render leaking from
another server or database.

## ArchView snapshots and host usage

`loadArchitectureSnapshot` and `/api/architecture` write the complete, redacted
`/api/architecture` body to `archview-snapshots` after a successful live fetch,
one row per resolved source and project, replaced in place. A failed live fetch
reads that row and serves it; only a missing or older-than-30-day row falls back
to the degraded state. `ARCHVIEW_SNAPSHOT_MAX_AGE_DAYS` overrides the ceiling.
Writes are throttled to one a minute and skipped when the body is unchanged.

Source resolution does not require `ARCHVIEW_SECRET_KEY`: without a usable key
it reads the row's origin, project and id and omits the credentials. That is what
lets dev and CI render the cached snapshot. The key is still required for an
authenticated live fetch.

The admin host-usage view opens on the first source that has samples in the
selected range (one grouped query), falling back to the first source only when
none has samples. An explicit `?host=` that still exists is always honoured.

## Public repository: no real hosts or secrets in documentation

This repository is public. Documentation — `README.md`, any other `*.md`, and any `*.example` env
file — must never contain a real hostname, public IP address, channel/user/tenant/client id, API
key, token or password from the operator's deployment.

- Hosts: use `example.com` subdomains (`www.example.com`, `archview.example.com`, `host1.example.com`).
- Public IPs: use a TEST-NET address (`203.0.113.10`).
- Ids and secrets: use obviously fake values (`000000000000000000`, `replace-with-a-token`).
- Describe the shape ("the operator's own domain") rather than naming the real thing.
- When a code default is only a convenience and the deployment sets the variable explicitly, the
  default is documentation too: give it a placeholder.
