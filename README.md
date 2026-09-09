# DevOps Portfolio

This workspace contains a static portfolio site for a developer with a DevOps focus.

## What’s included

- A bold single-page portfolio with hero, work, experience, and contact sections.
- A live architecture panel that fetches JSON from a host-provided Go service.
- A Decap CMS admin at `/admin/` backed by MongoDB for editable page content.
- A fallback rendering path so the page still shows useful state when the feed is unavailable.

## Architecture feed

By default the site calls `http://localhost:8080/api/architecture`. The telemetry service lives in the sibling `archview` repo and runs as a separate container.

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

## CMS

The content editor stores documents in MongoDB through the `cms-api` service.

The CMS API exposes:

- `GET /api/cms/site`
- `GET /api/cms/collections/:collection`
- `GET /api/cms/collections/:collection/:slug`
- `PUT /api/cms/collections/:collection/:slug`
- `DELETE /api/cms/collections/:collection/:slug`

Open `/admin/` to manage the home page, projects, experience entries, and contact block.

MongoDB database name defaults to `rossmoney_me`.

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

Local stack values now live in `.env` and are loaded by Compose.

## Environment file

Create a root `.env` file with these values:

```ini
ARCHVIEW_PORT=8080
CMS_API_PORT=8082

MONGODB_URI=mongodb://mongo:27017
MONGODB_DATABASE=rossmoney_me
MONGODB_COLLECTION=cms_documents
MONGODB_SEED_DEFAULTS=true

DOCKER_API_VERSION=v1.44
DOCKER_HOST=tcp://socket-proxy:2375
HOST_PROC=/host/proc
HOST_SYS=/host/sys
HOST_ROOT=/host/root

CONTAINERS=1
IMAGES=1
INFO=1
PING=1
POST=0
VERSION=1
LOG_LEVEL=info
```

The first block is for the CMS and telemetry services; the remaining socket-proxy variables are passed through to the Docker API proxy.

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

The frontend remains plain HTML, CSS, and JavaScript; the CMS API is a separate Go service backed by MongoDB.
