# AGENTS.md

Operational notes for agents working in this repo. The design system itself is
documented in [`DESIGN.md`](./DESIGN.md); read that before changing anything
visual.

## Build and test

Run from the repo root:

```bash
pnpm --dir payload-cms install --frozen-lockfile --prefer-offline
pnpm --dir payload-cms build
pnpm --dir payload-cms lint
pnpm --dir payload-cms test:int
pnpm --dir payload-cms lint:tokens
```

- `test:int` starts a disposable MongoDB when no `MONGODB_URI` is configured.
- `test:e2e` needs a running app on `http://localhost:3000` and a database; it
  is not part of `test:int`.
- The build uses Payload's no-op database adapter during the production build,
  so it does not need a live MongoDB.
- No new dependencies are needed for the token guard; it is plain Node.

## Server URL

Payload builds absolute URLs (media, password resets) from
`payload-cms/src/utilities/serverURL.ts`. Precedence: explicit `SERVER_URL` or
`NEXT_PUBLIC_SERVER_URL`, then Vercel's `VERCEL_URL` (the deployment itself),
then `VERCEL_PROJECT_PRODUCTION_URL`, then `http://localhost:8082`.

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
| `payload-cms/tailwind.config.mjs` | Tailwind typography plugin overrides |
| `payload-cms/scripts/check-tokens.mjs` | Raw-colour guard and named exceptions |
| `payload-cms/src/app/(payload)/custom.scss` | Payload admin styling (leave alone) |

The old root `styles.css` duplicate has been removed; do not reintroduce it.
