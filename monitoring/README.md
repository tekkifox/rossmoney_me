# Monitoring dashboard

Serves the Trivy and Lynis reports over plain nginx.

## Files

- `Dockerfile` — dashboard image, extends `nginx:1.27-alpine`.
- `nginx.conf` — server block, baked into the image.
- `../docker-compose.monitoring.yml` — the stack.

## Services

| Service | Role |
|---|---|
| `reports-init` | One-shot. Chowns the report volume tree to 1001:1001. |
| `lynis-converter` | One-shot. Renders `lynis-report.dat` into HTML. |
| `dashboard` | nginx on the external `proxy` network at 172.18.0.22:8083. |

No host ports are published. The reverse proxy reaches the dashboard by IP or
service name.

## Why plain nginx

`aquasecurity/trivy-dashboard` is unpublished — the GitHub repo 404s and the
GHCR package returns `DENIED`. The community alternatives
(`raoulx24/trivy-operator-dashboard`, `tobydoescode/trivy-dashboard`,
`locustbaby/trivy-ui`) all read Kubernetes Trivy Operator `VulnerabilityReport`
CRDs, so they only work inside Kubernetes. This is an autoindex of report files,
not an interactive UI.

## Configuration decisions

**The config is baked into the image.** Compose `configs` materialises as a
root-owned file in a `0700` directory, which the non-root master cannot read:

```
nginx: [emerg] open() "/etc/nginx/conf.d/default.conf" failed (13: Permission denied)
```

A `COPY` in the build gives mode 644 regardless of host file ownership. A host
*bind* mount would also need the file to exist on the server at the right path,
which broke silently before.

**`try_files $uri $uri/` is deliberately absent.** For `GET /` it resolves to
`//`, which nginx normalises with a 301 back to an absolute URL carrying its own
`:8083`, bouncing the browser out to an unexposed container port. Plain `root` +
`autoindex` serves files and lists directories with no redirect. `absolute_redirect
off` and `port_in_redirect off` cover the remaining cases.

**The volume mounts at `/reports`, not `/usr/share/nginx/html`.** Docker seeds a
fresh named volume from whatever the image has at the mount point, so mounting
over the html directory copies nginx's stock `index.html` into the volume. Since
the `index` module runs before `autoindex`, it is then served at `/` instead of
the report listing. Serving from a path the image does not populate removes the
problem entirely.

**`tmpfs` on `/var/cache/nginx`, `/var/run` and `/tmp`.** The upstream image runs
nginx as root and writes its pid, temp bodies and cache under those paths. Dropping
to uid 1001 without writable copies fails at startup with a misleading permission
error.

**`depends_on: service_completed_successfully` on `reports-init`.** Docker creates
named volumes root-owned, so the chown must happen before the scanner writes or
nginx reads. The chown is recursive because the host Lynis cron writes as root and
earlier scanner runs may predate a uid change.

`chmod -R a+rX` rather than `755`: capital `X` adds execute only to directories
and already-executable files, so subdirectories stay traversable without marking
every report as an executable.

## Running

```bash
docker compose -f docker-compose.monitoring.yml up -d --build
```

`reports-init` and `lynis-converter` run to completion and exit; only the
dashboard persists. The converter exits 0 with a `SKIP:` message when no Lynis
report exists yet, so a fresh volume does not block the dashboard.

Verify volume state directly rather than trusting the containers:

```bash
docker run --rm -v rossmoney_monitoring-reports:/r alpine ls -la /r
```
