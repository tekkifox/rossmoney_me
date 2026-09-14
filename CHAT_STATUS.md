# Chat Status

## Current State
- Travelling page is CMS-driven via `payload-cms/src/app/(payload)/api/cms/travel/route.ts`.
- Travelling page uses the shared main-site menu and a dedicated contact panel.
- Travelling commits are sourced from `tekkifox/image-mosaic` via the travel CMS payload.
- ArchView filters project containers/images for `image-mosaic` using project-aware logic.

## Constraints
- Do not change existing seed page content unless explicitly requested.

## Notes
- Static `index.html` and `travelling/index.html` are still serving the current Nginx-based frontend.
