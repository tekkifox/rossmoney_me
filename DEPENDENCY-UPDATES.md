# Dependency updates and the production audit gate

This repo keeps dependencies current with Renovate and blocks known-vulnerable
production dependencies in CI. Neither mechanism changes a dependency version
by itself: Renovate only opens reviewable PRs, and the audit gate either passes
or fails.

## Renovate

Config: [`renovate.json`](./renovate.json).

Renovate is used instead of Dependabot because this repo needs one update PR
across the thirteen `@payloadcms/*` packages plus `payload` itself, a separate
lockstep PR for `next` and `eslint-config-next`, and pnpm lockfile maintenance.
Renovate expresses all of that in `packageRules` and keeps the lockfile in the
same PR as the manifest change. Dependabot can group updates, but it groups
within its own rules and does not give the same lockfile-only maintenance
control.

### Rules encoded in `renovate.json`

| Rule                                             | Config                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@payloadcms/*` and `payload` update in one PR   | `packageRules` group `Payload`, `separateMajorMinor: false`                                                                              |
| `next` and `eslint-config-next` stay in lockstep | `packageRules` group `Next.js`, `separateMajorMinor: false`                                                                              |
| pnpm lockfile is updated                         | Renovate's npm/pnpm manager updates `payload-cms/pnpm-lock.yaml` in the same PR; `lockFileMaintenance` also opens lockfile-only PRs      |
| No calendar window (deliberate)                  | No `schedule` at the top level or on `lockFileMaintenance`; `timezone: "Europe/London"` still sets the zone for anything scheduled later |
| Throttle is concurrency, not the calendar        | `prConcurrentLimit: 3`, `prHourlyLimit: 2` — these cap the PR flood, so updates can be raised on any day                                 |
| Rebase policy                                    | `rebaseWhen: "conflicted"`                                                                                                               |
| No automerge, especially majors                  | `automerge: false` globally and in every group; the major rule repeats it                                                                |
| Vulnerability PRs                                | `vulnerabilityAlerts.enabled: true` with `schedule: ["at any time"]`, so security fixes never wait                                       |

`separateMajorMinor: false` is deliberate in both groups. Renovate otherwise
splits major from minor updates even inside a group, which is exactly the split
Payload minor we do not want. Major PRs still cannot merge without a human
because automerge is off.

### Why there is no calendar window

There is deliberately no weekly `schedule` window, and `lockFileMaintenance`
has none either. Renovate may act on any day it runs.

A weekly window is a bad throttle and a worse diagnostic:

- **It hides misconfiguration.** If the config or the app installation is
  broken, a once-a-week window means the breakage goes unnoticed for up to seven
  days — the repo simply looks quiet, which is exactly what a healthy week looks
  like too. With no window, a missing dashboard/PR after the first run is an
  immediate signal that something is wrong.
- **It delays security fixes.** A vulnerability published on Tuesday should not
  wait until next Monday. `vulnerabilityAlerts.schedule` is `["at any time"]`
  for the same reason, and the general config now matches it.

The flood protection is `prConcurrentLimit: 3` and `prHourlyLimit: 2`, which
bound how many PRs exist at once and how many are opened per hour regardless of
when Renovate runs. The calendar never contributed to that bound; it only
postponed work. If updates ever need to be paused, disable them or use a short,
intentional window — do not reintroduce a standing weekly gate.

Renovate reads its config from the default branch. **A repo admin must install
the Renovate app for `tekkifox/rossmoney_me` before any of this runs.** The
hosted app is free for public repositories; check the Mend plan if this repo is
private. That access grant is outside this repository, so no config here can
compensate for it. The first run can take a while after installation; the
**Dependency Dashboard issue** is the signal that Renovate has processed this
repo. Until that issue exists, nothing is being updated yet.

## Audit gate

Workflow: [`.github/workflows/dependency-audit.yml`](./.github/workflows/dependency-audit.yml).
Script: [`payload-cms/scripts/audit-production.mjs`](./payload-cms/scripts/audit-production.mjs).

The workflow runs on every `pull_request`, on a weekly schedule
(`0 6 * * 1`, Mondays 06:00 UTC), and on `workflow_dispatch`. It installs with
`corepack pnpm@10.11.0`, then runs:

```bash
cd payload-cms
corepack pnpm@10.11.0 run audit:prod
```

`audit:prod` calls:

```bash
corepack pnpm@10.11.0 audit --prod --audit-level high --json
```

and then filters the JSON to `high` and `critical` advisories in production
dependencies. Anything left after applying `.github/audit-allowlist.json`
fails the job.

### Verified pnpm 10.11.0 behaviour

These checks were run locally with the pinned `corepack pnpm@10.11.0`:

- A scratch project with `lodash@4.17.15` as a production dependency:
  `pnpm audit --prod --audit-level high` exited `1`; the same audit with
  `--audit-level critical` exited `0` because the advisories were high, not
  critical. The threshold controls the exit status.
- A scratch project whose only vulnerable package was a devDependency:
  `pnpm audit --prod --audit-level high` exited `0`; the same audit without
  `--prod` exited `1`. `--prod` excludes devDependencies.
- The current tree exits `1` from
  `pnpm audit --prod --audit-level high` because of the seven high/critical
  production advisories listed below.
- pnpm 10.11.0 still prints lower-severity advisories, and includes them in the
  JSON report, even when `--audit-level high` is set. That is why the gate does
  not rely on the flag for filtering: it filters the JSON itself, and uses the
  flag only so the standalone command has the expected exit behaviour.
- The gate script failed on a deliberately vulnerable scratch project and
  passed both on a clean scratch project and on this tree once the current
  advisories were explicitly allow-listed. The scratch projects were deleted;
  no vulnerable version is committed.

### Current allow-list

File: [`.github/audit-allowlist.json`](./.github/audit-allowlist.json). Each
entry is one advisory, one package, a reason, and a review date.

| Advisory              | Package         | Severity | Review by  | Why it is accepted                                                                                                                      |
| --------------------- | --------------- | -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GHSA-cg2g-xh64-v4q7` | `dompurify`     | critical | 2026-11-30 | Transitive via `@payloadcms/ui > @monaco-editor/react > monaco-editor`; resolved 3.4.8, fixed in 3.4.17, needs a Payload/monaco release |
| `GHSA-mrv2-3pqr-j5jr` | `dompurify`     | high     | 2026-11-30 | Same dompurify path; fixed in 3.4.17                                                                                                    |
| `GHSA-rfgv-xxqx-mfg5` | `undici`        | high     | 2026-11-30 | Transitive via `payload@3.90.2`; resolved 7.29.0, fixed in 7.29.1                                                                       |
| `GHSA-w293-vg96-wgc3` | `undici`        | high     | 2026-11-30 | Same `payload` path; fixed in 7.29.1                                                                                                    |
| `GHSA-xjj6-f33q-929c` | `undici`        | high     | 2026-11-30 | Same `payload` path; fixed in 7.30.1                                                                                                    |
| `GHSA-834v-8h66-3h79` | `happy-dom`     | high     | 2026-11-30 | Transitive via `@payloadcms/richtext-lexical > @lexical/headless`; resolved 20.14.5, fixed in 21.0.4                                    |
| `GHSA-68fv-2mgg-jv7q` | `source-map-js` | high     | 2026-11-30 | Transitive via `@payloadcms/next > sass`; resolved 1.2.1, fixed in 1.2.2                                                                |

`fast-uri` also has open advisories today, but they are moderate/low only
(resolved 3.1.7, fixes in 3.1.8/3.1.9). It is therefore below this gate's
threshold and is deliberately **not** allow-listed. If a future high or
critical advisory appears for it, the gate fails and the advisory needs its own
entry.

Review date semantics: an entry stops working at the start of its `reviewBy`
date. The gate then fails even if the advisory is gone, which forces someone to
re-check the advisory and either renew the reason/date or delete the entry.
Entries that no longer match an advisory produce a warning so they can be
removed.

### Adding a deliberate exception

1. Confirm the advisory is high or critical, production, and not fixable by a
   dependency update you can land now.
2. Add one entry to `.github/audit-allowlist.json`:

   ```json
   {
     "id": "GHSA-xxxx-xxxx-xxxx",
     "package": "exact-package-name",
     "severity": "high",
     "reason": "Who pulls it in, why it cannot be fixed yet, and what would remove it.",
     "reviewBy": "2026-12-31"
   }
   ```

3. Run the gate locally (see below) and confirm the only failures are the
   advisory you are accepting.
4. Open the exception as part of the PR, so the reason and date are reviewable.

Requirements enforced by the script: `id` must be a GHSA or CVE identifier,
`package` must be one exact name (no `*`), `severity` must be `high` or
`critical`, `reason` must be substantive, and `reviewBy` must be a real
`YYYY-MM-DD` date in the future.

Never do any of these instead:

- lower `--audit-level`
- use `pnpm audit --ignore`, `--ignore-unfixable`, or an `auditConfig` ignore list
- add a wildcard or package-wide entry
- accept an advisory without a review date

The script also fails if pnpm reports muted advisories, so a blanket ignore
cannot silently bypass the gate.

## Local checks

```bash
cd payload-cms
corepack pnpm@10.11.0 install --frozen-lockfile --prefer-offline
corepack pnpm@10.11.0 run audit:prod
```

Validate the Renovate config against the published schema before changing it —
a schema error silently disables every update:

```bash
npx --yes --package renovate renovate-config-validator \
  --no-global --strict renovate.json
```

`--no-global` validates it as repo config, and `--strict` fails on warnings, not
just schema errors.

The script accepts test-only overrides:

```bash
# Audit a scratch project and an explicit allow-list.
node scripts/audit-production.mjs \
  --dir /tmp/audit-scratch \
  --allow-list /tmp/audit-scratch/allowlist.json \
  --today 2026-10-26
```

`--today` is only for testing review-date expiry. Normal CI runs use the real
date.

## What was and was not verified

- The audit workflow ran on GitHub for both draft PRs (one against `dev`, one
  against `main`) and the `audit` job passed in both runs.
- The gate was also run locally with the pinned pnpm version, including the
  deliberately vulnerable scratch case described above.
- The Renovate app is installed, but a run was not observed while making this
  change. The first run can take a while after installation; the **Dependency
  Dashboard issue** is the signal that Renovate has processed the repo. Branch
  protection and the first update PR remain unverified here.
- No dependency version is changed by this tooling.
