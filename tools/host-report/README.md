# host-report

A small daily service that reads the last 24 hours of host health from Oracle
and posts a short report to the captain's Discord "automations" server.

- Runs **once at 09:00** (cron in the container), sends, and exits.
- One line per host: samples, last-seen age, CPU average/peak, memory average,
  load average/peak, and disk.
- Flags stale hosts and threshold breaches explicitly.
- Webhook delivery by default; Composio is an opt-in secondary path.
- Pure formatting: `build_report(rows, now=...)` returns the message, so all
  formatting tests run without a database or network.

## What the report looks like

```text
**Host report** — 2026-10-31 09:00 UTC
3/3 hosts reported, 0 stale, 1 flagged
- [!] rossmoney.me: 53 samples, last-seen 4m ago; CPU 44.8% avg / 117.0% peak; mem 22.6% avg; load 0.44 avg / 1.17 peak; disk 30.9% (CPU peak 117.0% >= 90%)
- photos.rossmoney.me: 46 samples, last-seen 3m ago; CPU 22.8% avg / 28.0% peak; mem 30.6% avg; load 0.23 avg / 0.28 peak; disk 80.3%
- vortexservers.co.uk: 49 samples, last-seen 3m ago; CPU 17.9% avg / 25.2% peak; mem 75.7% avg; load 3.57 avg / 5.04 peak; disk 71.2%
```

The first line under the header is the summary: how many hosts reported, how
many are stale, and how many carry a marker.

A host is `STALE` when it has no sample in the last 20 minutes (including a
host that sent nothing in the whole 24-hour window). A host gets a `[!]` marker
and an inline reason when any of these are at or above the threshold:

| Signal | Threshold |
| --- | --- |
| CPU peak | 90% |
| Memory average | 90% |
| Load peak | 8 |
| Disk (latest sample) | 90% |

Average/peak values are computed over the 24-hour window; disk is the value
from the most recent sample. "Last-seen" and the report timestamp are UTC.

Discord rejects messages over 2,000 characters. When a report would exceed
that, host lines are dropped from the end (the order is deterministic: known
hosts first, then any other hosts in name order) and the message ends with
`… truncated: N host line(s) not shown`. The result is always at most 2,000
characters.

## Data source

`report.py` reads `ROSSMONEY."host-samples"`, the table behind Oracle's
MongoDB-compatible `host-samples` collection. Each row has a JSON `data`
column with `hostLabel`, `sampledAt` (ISO-8601 UTC), `cpuAvg`,
`memoryPercent`, `loadAvg`, `diskPercent` and `swapPercent`.

The connection is the same approach as
`tools/oracle-search-mcp/oracle_search.py`: thin-mode `oracledb`, credentials
and wallet from the environment, and a parameterised statement. Only the
window boundary is a bind variable:

```sql
SELECT data
FROM ROSSMONEY."host-samples"
WHERE JSON_VALUE(data, '$.sampledAt') >= :since_iso
```

The Python side parses every `sampledAt` and applies the 24-hour window again,
so a row with an unexpected timestamp cannot distort the report. Rows that are
not valid JSON objects are skipped.

## Environment

### Oracle

| Variable | Required | Meaning |
| --- | --- | --- |
| `ORACLE_TNS_ADMIN` | yes | Directory holding the wallet and `tnsnames.ora`. The compose service mounts the wallet at `/wallet` and sets this to `/wallet`. |
| `ORACLE_USER` | yes | User that can read `ROSSMONEY."host-samples"` |
| `ORACLE_PASSWORD` | yes | Password for that user |
| `ORACLE_DSN` | yes | TNS alias from `tnsnames.ora`, e.g. `rossadb_high` |
| `ORACLE_WALLET_PASSWORD` | no | Only if the wallet's `ewallet.pem` is password-protected |

### Delivery

| Variable | Required | Meaning |
| --- | --- | --- |
| `HOST_REPORT_DELIVERY` | no | `webhook` (default) or `composio` |
| `DISCORD_WEBHOOK_URL` | webhook | Discord webhook URL; the report is posted as `{"content": "..."}` |
| `COMPOSIO_API_KEY` | composio | Composio API key |
| `DISCORD_CHANNEL_ID` | composio | Target channel |
| `COMPOSIO_CONNECTED_ACCOUNT_ID` | no | Connected account to execute with; omitted when Composio can infer it |
| `COMPOSIO_DISCORD_ACTION` | no | Action slug, default `DISCORD_SEND_MESSAGE` |
| `COMPOSIO_BASE_URL` | no | Default `https://backend.composio.dev` |

### Report and schedule

| Variable | Required | Meaning |
| --- | --- | --- |
| `HOST_REPORT_HOSTS` | no | Comma-separated host list. Defaults to `rossmoney.me,photos.rossmoney.me,vortexservers.co.uk`; hosts found in the data are added in name order |
| `HOST_REPORT_DRY_RUN` | no | `1`/`true` prints the report without sending |
| `TZ` | no | Container and cron timezone, default `Europe/London` |
| `HOST_REPORT_CRON` | no | Cron expression, default `0 9 * * *` |
| `ORACLE_WALLET_DIR` | no | **Host** path bind-mounted read-only at `/wallet` (compose substitution only; not a container variable) |

`stack.env` is the shared env file for the Portainer and local compose stacks.
Put the Oracle credentials, `DISCORD_WEBHOOK_URL` and `ORACLE_WALLET_DIR` there.
`ORACLE_TNS_ADMIN` is always overridden to `/wallet` inside the container.

## Build

```bash
cd tools/host-report
docker build -t rossmoney-me-host-report .
```

CI publishes `ghcr.io/tekkifox/rossmoney_me-host-report:latest` from `main`
(`.github/workflows/host-report-publish.yml`, linux/amd64).

## Test a send manually

Dry run first, which fetches from Oracle, prints the exact message, and sends
nothing:

```bash
docker run --rm \
  --env-file ../../stack.env \
  -e ORACLE_TNS_ADMIN=/wallet \
  -v "${ORACLE_WALLET_DIR:?set ORACLE_WALLET_DIR}:/wallet:ro" \
  --entrypoint /usr/local/bin/python \
  rossmoney-me-host-report /app/main.py --dry-run
```

Remove `--dry-run` to post it for real. The entrypoint starts cron only when
the image is run normally, so this one-shot command never waits for 09:00.

Without Docker:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
ORACLE_TNS_ADMIN=/path/to/Wallet_rossadb \
ORACLE_USER=ROSSMONEY \
ORACLE_PASSWORD=... \
ORACLE_DSN=rossadb_high \
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... \
.venv/bin/python main.py --dry-run
```

Exit codes: `0` means the report was built (and delivered, unless dry-run);
`1` means the fetch or delivery failed and the reason is on stderr. Cron captures
both streams in the container log.

## How the schedule works

The image uses Debian's `cron`, which is already available in
`python:3.12-slim` once the `cron` package is installed. On start,
`entrypoint.sh`:

1. mirrors `TZ` into `/etc/localtime` (Debian cron reads the system timezone,
   not `$TZ`);
2. writes the container environment to `/etc/host-report.env` as shell-quoted
   exports, because cron does not inherit the container environment;
3. writes `/etc/cron.d/host-report` with `0 9 * * *` (or `HOST_REPORT_CRON`) as
   root, sourcing that env file and running `python /app/main.py`;
4. runs `cron -f` as PID 1.

Each run is a separate short process: `main.py` fetches, sends, and exits. There
is no Python sleep loop, so a container restart never sends an extra report and
a failed send is one log line rather than a wedged loop. `cron` also handles a
missing run after the container was down: it does not replay missed schedules,
which is deliberate — the next 09:00 report covers the previous 24 hours.

## Compose

`docker-compose.portainer.yml` adds a `host-report` service on the existing
`rossmoney-stack` network. It has no published ports, uses `env_file:
stack.env`, mounts the Oracle wallet read-only, and pulls
`ghcr.io/tekkifox/rossmoney_me-host-report:latest`.

Set these in the Portainer stack's `stack.env`:

```dotenv
ORACLE_WALLET_DIR=/opt/oracle/Wallet_rossadb
ORACLE_USER=ROSSMONEY
ORACLE_PASSWORD=...
ORACLE_DSN=rossadb_high
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## Switching delivery to Composio

Composio is secondary and off by default. It is implemented behind
`HOST_REPORT_DELIVERY=composio` so it can be switched on once a Discord **bot**
is connected in Composio.

**Composio's Discord integration currently only has a user-OAuth connection,
which cannot post messages.** Until a bot connection exists, enabling this path
will fail at Composio; the webhook path is the one that works today.

To switch:

```dotenv
HOST_REPORT_DELIVERY=composio
COMPOSIO_API_KEY=...
DISCORD_CHANNEL_ID=...
# Optional:
COMPOSIO_CONNECTED_ACCOUNT_ID=...
# COMPOSIO_DISCORD_ACTION=DISCORD_SEND_MESSAGE
# COMPOSIO_BASE_URL=https://backend.composio.dev
```

The request is `POST {COMPOSIO_BASE_URL}/api/v2/actions/{action}/execute` with
`x-api-key: $COMPOSIO_API_KEY` and:

```json
{
  "input": {"channel_id": "...", "content": "..."},
  "connected_account_id": "..."
}
```

A non-2xx response or `{"successful": false}` is a delivery failure and exits 1.
Keep `DISCORD_WEBHOOK_URL` set while testing so rolling back is just removing
`HOST_REPORT_DELIVERY`.

## Tests

```bash
cd tools/host-report
python3 -m unittest discover -s tests -v
```

No virtualenv, database, wallet or network is needed: `oracledb` is imported
lazily and both the database and HTTP calls are injected fakes. The suite covers
all-healthy hosts, one stale host, missing hosts, each threshold (including the
inclusive boundary), the empty result set, the 24-hour window, long ages,
2,000-character truncation, Oracle binding/connection failures, webhook
success/failure, Composio payloads and failures, delivery selection, a single
run, and dry-run.

## Layout

| File | Purpose |
| --- | --- |
| `report.py` | Oracle fetch, 24-hour window, summaries, message formatting, truncation |
| `main.py` | One-shot orchestration, webhook and Composio delivery, `--dry-run` |
| `entrypoint.sh` | Prepare `/etc/cron.d/host-report`, then `cron -f` |
| `Dockerfile` | Python 3.12 slim + `cron` + `oracledb`, entrypoint |
| `tests/` | Unit tests with fake database and HTTP |
| `requirements.txt` | `oracledb` |
