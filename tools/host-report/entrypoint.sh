#!/bin/sh
# Container entrypoint: install the 09:00 cron entry, then keep cron in the
# foreground as PID 1. One report is one short `python main.py` run; there is no
# sleep loop in Python.
set -eu

HOST_REPORT_CRON="${HOST_REPORT_CRON:-0 9 * * *}"

# Debian cron reads the system timezone, not $TZ, so mirror it before starting.
if [ -n "${TZ:-}" ] && [ -f "/usr/share/zoneinfo/${TZ}" ]; then
    ln -snf "/usr/share/zoneinfo/${TZ}" /etc/localtime
    echo "${TZ}" > /etc/timezone
fi

# cron does not inherit the container environment. Snapshot it as shell-quoted
# exports so values containing spaces or quotes survive sourcing. The file is
# root-only because it contains the Oracle password and Discord webhook.
umask 077
/usr/local/bin/python - <<'PY'
import os
import shlex

with open("/etc/host-report.env", "w", encoding="utf-8") as handle:
    for key, value in os.environ.items():
        handle.write(f"export {key}={shlex.quote(value)}\n")
PY

cat > /etc/cron.d/host-report <<EOF
SHELL=/bin/sh
PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin
${HOST_REPORT_CRON} root set -a; . /etc/host-report.env; set +a; exec /usr/local/bin/python /app/main.py >> /proc/1/fd/1 2>&1
EOF
chmod 0644 /etc/cron.d/host-report

echo "host-report: schedule '${HOST_REPORT_CRON}' (TZ=${TZ:-UTC})" >&2
exec cron -f
