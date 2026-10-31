"""Deterministic daily host report for the ross.money hosts.

The module has two halves:

* :func:`fetch_samples` reads ``ROSSMONEY."host-samples"`` from Oracle using the
  same thin-mode, wallet-driven connection as ``tools/oracle-search-mcp``.
* :func:`build_report` turns rows into the Discord message. It is pure - pass
  the rows and ``now`` in, get a string out - so every formatting case is unit
  tested without a database.

:mod:`main` is the entry point that fetches the rows and delivers the message.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Mapping, Sequence

#: Discord rejects messages longer than this many characters.
DISCORD_LIMIT = 2000

#: A host with no sample within this window is reported as stale.
STALE_MINUTES = 20

#: How much history the report covers.
WINDOW_HOURS = 24

#: Thresholds that put a ``[!]`` marker on a host line. They are inclusive:
#: exactly 90% CPU is a problem, just like 90.1%.
CPU_PEAK_PERCENT = 90.0
MEMORY_PERCENT = 90.0
LOAD_PEAK = 8.0
DISK_PERCENT = 90.0

#: Hosts the report always mentions, even when they sent no samples at all.
#: Override with ``HOST_REPORT_HOSTS`` (comma-separated).
KNOWN_HOSTS: tuple[str, ...] = (
    "rossmoney.me",
    "photos.rossmoney.me",
    "vortexservers.co.uk",
)

#: The Oracle collection, exposed by Oracle's MongoDB-compatible API as a table
#: named ``"host-samples"`` with a JSON ``data`` column.
SAMPLES_TABLE = 'ROSSMONEY."host-samples"'

#: The only SQL this module runs. ``sampledAt`` is an ISO-8601 UTC string in
#: every row the sampler writes, so a lexical comparison selects the window.
#: The Python side parses and re-filters the timestamps as well.
SAMPLES_SQL = f"""
SELECT data
FROM {SAMPLES_TABLE}
WHERE JSON_VALUE(data, '$.sampledAt') >= :since_iso
"""

ENV_VARS = ("ORACLE_TNS_ADMIN", "ORACLE_USER", "ORACLE_PASSWORD", "ORACLE_DSN")

#: Optional: password for an encrypted wallet (``ewallet.pem``).
WALLET_PASSWORD_ENV = "ORACLE_WALLET_PASSWORD"

TRUNCATION_NOTICE = "\u2026 truncated: {count} host line(s) not shown"

ConnectionFactory = Callable[..., Any]


class ReportError(RuntimeError):
    """The report could not be fetched or built. Safe to show in logs."""


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def connection_params(env: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Build ``oracledb.connect`` keyword arguments from the environment.

    This mirrors ``tools/oracle-search-mcp/oracle_search.py``: credentials are
    never defaulted or hard-coded, and the wallet directory is passed as both
    ``config_dir`` and ``wallet_location`` (what thin mode needs to resolve the
    TNS alias and open the wallet).
    """

    source = os.environ if env is None else env
    missing = [name for name in ENV_VARS if not source.get(name)]
    if missing:
        raise ReportError(
            "Missing Oracle connection environment variable(s): "
            + ", ".join(missing)
            + ". See tools/host-report/README.md."
        )

    params: dict[str, Any] = {
        "user": source["ORACLE_USER"],
        "password": source["ORACLE_PASSWORD"],
        "dsn": source["ORACLE_DSN"],
        "config_dir": source["ORACLE_TNS_ADMIN"],
        "wallet_location": source["ORACLE_TNS_ADMIN"],
    }
    if source.get(WALLET_PASSWORD_ENV):
        params["wallet_password"] = source[WALLET_PASSWORD_ENV]
    return params


def _default_connect() -> ConnectionFactory:
    try:
        import oracledb
    except ImportError as exc:  # pragma: no cover - exercised in the image
        raise ReportError(
            "oracledb is not installed; run pip install -r requirements.txt"
        ) from exc
    return oracledb.connect


def _as_text(value: Any) -> str:
    """Normalise a driver value (str, bytes, JSON, LOB) to text."""

    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", errors="replace")
    if isinstance(value, Mapping):
        return json.dumps(value)
    read = getattr(value, "read", None)
    if callable(read):
        return _as_text(read())
    return str(value)


def _load_document(value: Any) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        return dict(value)
    text = _as_text(value).strip()
    if not text:
        return None
    try:
        document = json.loads(text)
    except (TypeError, ValueError):
        return None
    return document if isinstance(document, dict) else None


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return as_utc(value)
    text = _as_text(value).strip()
    if not text:
        return None
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return as_utc(parsed)


def _as_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def fetch_samples(
    since: datetime,
    *,
    connection_factory: ConnectionFactory | None = None,
    env: Mapping[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Return the host-sample documents at or after ``since``.

    Rows are selected with a bind variable; the timestamp is the only filter in
    SQL. ``build_report`` owns the final window check so the formatting stays
    testable. Rows that are not valid JSON objects are skipped rather than
    failing the whole report.
    """

    params = connection_params(env)
    factory = connection_factory or _default_connect()
    since_iso = as_utc(since).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        connection = factory(**params)
    except ReportError:
        raise
    except Exception as exc:
        raise ReportError(
            f"Could not connect to Oracle DSN {params['dsn']!r}: {exc}"
        ) from exc

    try:
        cursor = connection.cursor()
        try:
            cursor.execute(SAMPLES_SQL, {"since_iso": since_iso})
            rows = cursor.fetchall()
        finally:
            cursor.close()
    except ReportError:
        raise
    except Exception as exc:
        raise ReportError(f"Oracle host-sample query failed: {exc}") from exc
    finally:
        try:
            connection.close()
        except Exception:
            pass

    documents: list[dict[str, Any]] = []
    for row in rows:
        value = row[0] if isinstance(row, (tuple, list)) else row
        document = _load_document(value)
        if document is not None:
            documents.append(document)
    return documents


@dataclass
class HostSummary:
    host: str
    samples: int
    last_seen: datetime | None
    cpu_avg: float | None = None
    cpu_peak: float | None = None
    memory_avg: float | None = None
    load_avg: float | None = None
    load_peak: float | None = None
    disk: float | None = None
    stale: bool = False
    flags: list[str] = field(default_factory=list)


def _average(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _summarise(
    host: str,
    documents: Sequence[Mapping[str, Any]],
    *,
    now: datetime,
    stale_minutes: int,
) -> HostSummary:
    ordered = sorted(
        documents, key=lambda doc: _parse_timestamp(doc.get("sampledAt")) or now
    )
    last_seen = None
    if ordered:
        last_seen = _parse_timestamp(ordered[-1].get("sampledAt"))

    cpu = [v for v in (_as_float(d.get("cpuAvg")) for d in ordered) if v is not None]
    memory = [
        v for v in (_as_float(d.get("memoryPercent")) for d in ordered) if v is not None
    ]
    load = [
        v for v in (_as_float(d.get("loadAvg")) for d in ordered) if v is not None
    ]

    disk = None
    for document in reversed(ordered):
        disk = _as_float(document.get("diskPercent"))
        if disk is not None:
            break

    summary = HostSummary(
        host=host,
        samples=len(documents),
        last_seen=last_seen,
        cpu_avg=_average(cpu),
        cpu_peak=max(cpu) if cpu else None,
        memory_avg=_average(memory),
        load_avg=_average(load),
        load_peak=max(load) if load else None,
        disk=disk,
    )

    age = None if last_seen is None else now - last_seen
    summary.stale = age is None or age > timedelta(minutes=stale_minutes)

    if summary.stale:
        summary.flags.append(
            f"STALE: no sample in the last {stale_minutes}m"
        )
    if summary.cpu_peak is not None and summary.cpu_peak >= CPU_PEAK_PERCENT:
        summary.flags.append(
            f"CPU peak {summary.cpu_peak:.1f}% >= {CPU_PEAK_PERCENT:.0f}%"
        )
    if summary.memory_avg is not None and summary.memory_avg >= MEMORY_PERCENT:
        summary.flags.append(
            f"memory {summary.memory_avg:.1f}% >= {MEMORY_PERCENT:.0f}%"
        )
    if summary.load_peak is not None and summary.load_peak >= LOAD_PEAK:
        summary.flags.append(
            f"load peak {summary.load_peak:.2f} >= {LOAD_PEAK:.0f}"
        )
    if summary.disk is not None and summary.disk >= DISK_PERCENT:
        summary.flags.append(
            f"disk {summary.disk:.1f}% >= {DISK_PERCENT:.0f}%"
        )
    return summary


def _age(datetime_value: datetime | None, now: datetime) -> str:
    if datetime_value is None:
        return "unknown"
    seconds = int((now - datetime_value).total_seconds())
    if seconds < 0:
        seconds = 0
    if seconds < 60:
        return "just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m ago"
    hours, minutes = divmod(minutes, 60)
    if hours < 48:
        return f"{hours}h {minutes}m ago"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h ago"


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1f}%"


def _number(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def _host_line(summary: HostSummary, now: datetime) -> str:
    marker = "[!] " if summary.flags else ""
    if summary.samples == 0:
        body = "no samples in the last 24h; last-seen unknown"
    else:
        noun = "sample" if summary.samples == 1 else "samples"
        body = (
            f"{summary.samples} {noun}, last-seen {_age(summary.last_seen, now)}"
            f"; CPU {_percent(summary.cpu_avg)} avg / {_percent(summary.cpu_peak)} peak"
            f"; mem {_percent(summary.memory_avg)} avg"
            f"; load {_number(summary.load_avg)} avg / {_number(summary.load_peak)} peak"
            f"; disk {_percent(summary.disk)}"
        )
    if summary.flags:
        body += " (" + "; ".join(summary.flags) + ")"
    return f"- {marker}{summary.host}: {body}"


def _fit(header: str, lines: Sequence[str], limit: int) -> str:
    joined = header + "\n" + "\n".join(lines)
    if len(joined) <= limit:
        return joined

    for keep in range(len(lines), -1, -1):
        notice = "\n" + TRUNCATION_NOTICE.format(count=len(lines) - keep)
        candidate = header + "\n" + "\n".join(lines[:keep]) + notice
        if len(candidate) <= limit:
            return candidate

    fallback = header + "\n" + TRUNCATION_NOTICE.format(count=len(lines))
    return fallback[: max(limit - 1, 0)] + "\u2026"


def _known_hosts(known_hosts: Iterable[str] | None) -> tuple[str, ...]:
    return tuple(known_hosts) if known_hosts is not None else KNOWN_HOSTS


def build_report(
    rows: Iterable[Mapping[str, Any] | str],
    *,
    now: datetime | None = None,
    known_hosts: Iterable[str] | None = None,
    limit: int = DISCORD_LIMIT,
    stale_minutes: int = STALE_MINUTES,
) -> str:
    """Turn host-sample documents into the Discord message.

    ``rows`` are the documents returned by :func:`fetch_samples` (mappings or
    their JSON text). Every host in ``known_hosts`` gets a line even with no
    rows; any other host in the rows is appended in name order. The result is
    deterministic for a given ``rows``/``now``/``known_hosts`` and never longer
    than ``limit`` characters.
    """

    current = as_utc(now or datetime.now(timezone.utc))
    since = current - timedelta(hours=WINDOW_HOURS)

    grouped: dict[str, list[Mapping[str, Any]]] = {}
    extras: set[str] = set()
    for row in rows:
        document = _load_document(row)
        if document is None:
            continue
        host = _as_text(document.get("hostLabel")).strip()
        sampled_at = _parse_timestamp(document.get("sampledAt"))
        if not host or sampled_at is None:
            continue
        if sampled_at < since or sampled_at > current + timedelta(minutes=5):
            continue
        grouped.setdefault(host, []).append(document)
        extras.add(host)

    ordered_hosts: list[str] = []
    for host in _known_hosts(known_hosts):
        if host not in ordered_hosts:
            ordered_hosts.append(host)
    for host in sorted(extras):
        if host not in ordered_hosts:
            ordered_hosts.append(host)

    summaries = [
        _summarise(
            host,
            grouped.get(host, ()),
            now=current,
            stale_minutes=stale_minutes,
        )
        for host in ordered_hosts
    ]

    reported = sum(1 for summary in summaries if summary.samples)
    stale = sum(1 for summary in summaries if summary.stale)
    flagged = sum(1 for summary in summaries if summary.flags)

    header = (
        f"**Host report** \u2014 {current.strftime('%Y-%m-%d %H:%M')} UTC\n"
        f"{reported}/{len(summaries)} hosts reported, {stale} stale, "
        f"{flagged} flagged"
    )
    lines = [_host_line(summary, current) for summary in summaries]
    return _fit(header, lines, limit)
