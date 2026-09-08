# DevOps Portfolio

This workspace contains a static portfolio site for a developer with a DevOps focus.

## What’s included

- A bold single-page portfolio with hero, work, experience, and contact sections.
- A live architecture panel that fetches JSON from a host-provided Go service.
- A fallback rendering path so the page still shows useful state when the feed is unavailable.

## Architecture feed

By default the site calls `http://localhost:8080/api/architecture`. The Go service lives in `go-service/` and is intended to run as a separate container.

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

## Go service

The Dockerized service exposes:

- `/healthz`
- `/api/architecture`
- `/api/overview`
- `/api/docker`
- `/api/system`

Start it with Docker Compose or as a Portainer stack:

```bash
docker compose up -d
```

The stack is exposed on `http://localhost` through the reverse proxy. The browser uses same-origin `/api/architecture`, so it works cleanly in Portainer.

The ArchView service reaches Docker through `lscr.io/linuxserver/socket-proxy:latest` using `DOCKER_HOST=tcp://socket-proxy:2375`.

## Web UI image

The portfolio web UI is published separately as:

```text
ghcr.io/tekkifox/rossmoney_me:latest
```

It is built from [web/Dockerfile](web/Dockerfile) and deployed independently from the Go API image.

## Reverse proxy image

The Portainer-facing reverse proxy is published separately as:

```text
ghcr.io/tekkifox/rossmoney_me-proxy:latest
```

It is generated in CI from `nginx:1.27-alpine` and serves the web UI plus `/api/` routing.

## Portainer webhook

Set a repository secret named `PORTAINER_WEBHOOK_URL` to let GitHub Actions redeploy the Portainer stack after publishing the web or proxy image.

## Notes

The environment used here does not include a Node.js or Go toolchain, so this version is intentionally dependency-free.
