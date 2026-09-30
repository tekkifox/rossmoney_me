# Lynis reporting

Renders the host Lynis audit into HTML for the monitoring dashboard.

## Layout

- `lynis.cron` — root crontab entry: runs `lynis audit system` on the host, writes
  the report into the shared Docker volume, then re-runs the converter service.
- `converter.Dockerfile` — image for the converter service defined in
  `docker-compose.monitoring.yml`.

## Why Lynis runs on the host

Containerised Lynis audits the *container's* filesystem, not the host's. It reads
`/etc/shadow`, sysctl values, loaded modules and root-owned config via a bind
mount, but its own runtime is Alpine, so checks about the init system, kernel
modules and running services do not describe the host. Running natively as root
is the only way to get a real verdict; the container is kept solely for
rendering HTML.

The trade-off with the container stack is that unreadable things are reported as
*absent* rather than failing loudly, so a containerised score looks better than
reality. Treat it as a checklist, not an audit.

## Report files

The dashboard serves these from the `rossmoney_monitoring-reports` volume:

| File | Writer | Notes |
|---|---|---|
| `lynis-report.dat` | host cron | Lynis key/value report. The `.dat` extension matters: the converter parses `key=value` lines, **not** JSON. |
| `lynis.log` | host cron | Full uncoloured screen output (`--no-colors`). |
| `lynis-report.html` | converter service | The file to open in a browser. |

Older versions of this setup wrote the key/value report to `lynis-report.json`.
That was a misnomer and the converter could not read it.

## lynis-report-converter

[d4t4king/lynis-report-converter](https://github.com/d4t4king/lynis-report-converter)
turns the key/value report into a single HTML file, summarising each section.

**Only the HTML output path is used.** The converter `require`s `HTML::HTMLDoc`
(PDF) and `Excel::Writer::XLSX` (Excel) lazily, so neither is installed. If you
want PDF or Excel output, add those dependencies — `HTML::HTMLDoc` is a CPAN
module with a native `htmldoc` library, so it needs a build step, not just an
apt package.

### Dependency notes

`Term::ANSIColor`, which the converter `use`s, ships inside core
`perl-modules-5.36`. There is no `libterm-ansicolor-perl` package in Debian —
that name fails with `E: Unable to locate package`, and the older
`libansicolor-perl` was removed from the archive. Installing `perl` is
sufficient.

`CONVERTER_REF` pins the clone branch. It defaults to `master`; set a tag for
reproducible rebuilds.

## Scheduling

```bash
sudo crontab lynis/lynis.cron
```

Daily at 04:30. The job:

1. resolves the volume mountpoint with `docker volume inspect`
2. runs `/usr/sbin/lynis audit system --quick --no-colors`
3. `chmod 644` the outputs — nginx workers read as uid 101, and root crontabs
   often default to a 077 umask
4. re-runs `lynis-converter` with `--no-deps`, so the dashboard, nginx and the
   other report jobs are not restarted

`--quick` keeps the audit non-interactive; cron has no TTY, so a prompt would
hang the job. Use `--cronjob` if you want to be certain.

All paths are absolute because cron's `PATH` is minimal. `lynis` is at
`/usr/sbin/lynis` on Debian/Ubuntu, not `/usr/bin` — confirm with
`command -v lynis` if the job fails to start.

`--build` in step 4 means a network fetch of the converter repo at 04:30 daily.
Drop it if the host may be offline at that hour, at the cost of never picking up
upstream changes.

Verify the schedule without waiting:

```bash
sudo crontab -l
tail -50 /var/log/lynis-scan.log
```
