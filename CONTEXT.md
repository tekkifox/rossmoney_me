# Context

## Current State
- Travelling page is CMS-driven via `payload-cms/src/app/(payload)/api/cms/travel/route.ts`.
- Travelling page uses the shared main-site menu and a dedicated contact panel.
- Travelling commits are sourced from `tekkifox/image-mosaic` via the travel CMS payload.
- ArchView filters project containers/images for `image-mosaic` using project-aware logic.
- ArchView is its own stack in the sibling `archview` repo, deployed at `https://archview.rossmoney.me` with OAuth/OIDC login; this repo reaches it server-side via `ARCHVIEW_URL` + `ARCHVIEW_API_KEY`. It is no longer part of these Compose files.

## Constraints
- Do not change existing seed page content unless explicitly requested.
- `travelling.rossmoney.me` is a separate project; do not rewrite it through `payload-cms` middleware.
- ArchView should use real Docker daemon images filtered by the `image-mosaic` compose project; do not guess image names or metadata.

## Notes
- Static `index.html` and `travelling/index.html` are still serving the current Nginx-based frontend.

