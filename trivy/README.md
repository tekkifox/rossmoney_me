# Trivy image scanning stack

Scans the host OS and every local Docker image for vulnerabilities, secrets, and
misconfigurations, then publishes HTML/JSON/SBOM reports to the monitoring
dashboard.

## Files

- `Dockerfile` — image for both the `trivy` server and the `scan` job.
- `../docker-compose.trivy.yml` — the stack itself.
- `../docker-compose.monitoring.yml` — dashboard that serves the reports.

## Services

| Service | Role |
|---|---|
| `docker-api` | Read-only socket proxy. The only service that mounts `docker.sock`. |
| `trivy` | Long-running server on the internal network. Holds the warm vuln DB. |
| `scan` | One-shot full sweep. `docker compose run --rm scan` |

The scanner reaches Docker through `docker-api` over `http://docker-api:2375`,
**not** by mounting `docker.sock`. Raw socket access is root-equivalent on the
host: a compromised scanner could start a privileged container. The proxy allows
the read-only calls image scanning needs and denies `POST`, `EXEC`, `COMMIT`,
`BUILD`, `SWARM` and `SYSTEM`. `IMAGES`/`CONTAINERS` are unrestricted, so it can
see every image and all container metadata.

The `/host` bind mount is still required for the OS scan, so the scanner keeps
broad *read* access to the host filesystem. It is mounted `:ro`.

## Dockerfile notes

`curl` is installed here rather than at runtime because the upstream image ships
only `ca-certificates` and `git`, and `apk add` needs root — which the container
does not have once it drops to uid 1001. Busybox `wget` cannot speak the Docker
API over a unix socket.

`mkdir`/`chown` for `/var/cache/trivy` and `/reports` must run **before** the
final `USER 1001:1001`, or the build step is denied and the directories are never
created.

## Running

```bash
docker compose -f docker-compose.trivy.yml up -d
docker compose -f docker-compose.trivy.yml run --rm scan
```

`scan` prints the image list before it starts scanning, so socket or parsing
problems surface immediately instead of after several minutes of OS scanning.

Reports go to the `rossmoney_monitoring-reports` volume, served at `/` by the
dashboard.

## Gotchas encountered

Each of these produced a confusing symptom and is worth knowing about.

**The cache dir must be writable by uid 1001.** The upstream default is
`/root/.cache/trivy`, which uid 1001 cannot enter; it is overridden to
`/var/cache/trivy` via `--cache-dir` and `TRIVY_CACHE_DIR`. Named volumes are
chowned to the image's runtime user on first attach, so a volume created by an
earlier root-run container stays root-owned. Recreate it:

```bash
docker volume rm rossmoney_trivy-db rossmoney_trivy-db-scan
```

**The server and the scan job must not share a cache volume.** Trivy takes an
exclusive lock on its cache directory; sharing one fails with
`Failed to acquire cache or database lock`. Hence `trivy-db` and `trivy-db-scan`.

**`trivy server` has no `--scanners` flag.** Scanners are chosen by the client.
`--skip-db-update=false` is also invalid; DB updates are on by default.

**`trivy system` no longer exists.** It was renamed `trivy vm` and targets VM
images, not host-plus-images. The sweep uses `trivy rootfs /host` for the OS and
`trivy image` per image.

**Multi-tag images need the array parsed before comma-splitting.** Splitting the
Engine API JSON on commas first puts later tags on lines that no longer contain
`"RepoTags":[`, so the match silently misses them. `grep -o '"RepoTags":\[[^]]*\]'`
first, then split.

**`/host/var/lib/docker` must be skipped.** The overlayfs snapshots there cannot
be walked from a bind mount and abort the whole scan with
`walk dir error: unknown error`. Images are covered by `trivy image` regardless.
`/host/proc`, `/host/sys`, `/host/dev` and `/host/run` fail the same way.

**Shell variables need `$$` in this file.** Compose interpolates `$VAR` at parse
time, so every shell variable in the entrypoint is written `$$var`. A single
`$var` silently becomes empty — that produced `image-.html` and empty output
paths.

**`cmd \` + `||` continuations are fragile.** A trailing space after a backslash
breaks the continuation and yields `syntax error: unexpected "||"`. The script
uses `if ! cmd; then warn ...; fi` instead.

## Configuration

See `../.env.example` for the full set: `TRIVY_SKIP_DIRS`, `TRIVY_SCAN_IMAGES`,
`TRIVY_SCAN_SEVERITY`, `TRIVY_SCAN_IGNORE_UNFIXED`, `TRIVY_SCAN_SBOM`, and the
per-service CPU/memory limits.
