# DevOps Portfolio

This workspace contains a static portfolio site for a developer with a DevOps focus.

## What’s included

- A bold single-page portfolio with hero, work, experience, and contact sections.
- A dedicated `/travelling` page with a travel project summary and architecture snapshot.
- A live architecture panel that fetches JSON from a host-provided Go service.
- A Decap CMS admin at `/admin/` backed by MongoDB for editable page content.
- A fallback rendering path so the page still shows useful state when the feed is unavailable.

## Architecture feed

By default the site calls `http://localhost:8080/api/architecture`. The telemetry service lives in the sibling `archview` repo and runs as a separate container.

The travelling page uses `http://localhost:8080/api/architecture?project=image-mosaic`.

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

The Dockerized service exposes:

- `/healthz`
- `/api/architecture`
- `/api/overview`
- `/api/docker`
- `/api/system`

Start the stack with Docker Compose or deploy with Portainer.

Local (development) — exposes the CMS on port 8082:

```bash
docker compose -f docker-compose.yml up --build
```

Portainer stack (CI/production):

```bash
docker compose -f docker-compose.portainer.yml config
```

The CMS (Payload Next app) serves the portfolio and frontend routes directly on port 8082. The ArchView telemetry service still runs separately and exposes its API on port 8080. `stack.env` is shared by both local and Portainer Compose files.

## Environment file

Create a root `stack.env` file for local Compose with these values:

```ini
MONGODB_URI=mongodb://mongo:27017/rossmoney_me
PAYLOAD_SECRET=rossmoney_payload_secret_key_change_me
SERVER_URL=https://www.rossmoney.me
PAYLOAD_SEED=true

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

## Portainer webhook

Set a repository secret named `PORTAINER_WEBHOOK_URL` to let GitHub Actions redeploy the Portainer stack after publishing images.

## Notes

The CMS (Payload Next app) now serves the frontend and pages directly. The telemetry/architecture API is still a separate Go service backed by Docker and accessible at port 8080.
