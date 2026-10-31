"""Run the host report once, deliver it, and exit.

Scheduling belongs to the container (cron at 09:00), not to a ``sleep`` loop in
Python: this process does exactly one fetch and one delivery per invocation.

Delivery is chosen by ``HOST_REPORT_DELIVERY``:

* ``webhook`` (default) posts ``{"content": ...}`` to ``DISCORD_WEBHOOK_URL``.
  This is the path that works today.
* ``composio`` posts through Composio's action API with ``COMPOSIO_API_KEY``
  and ``DISCORD_CHANNEL_ID``. It is deliberately opt-in: the current Composio
  Discord connection is user OAuth and cannot post as a bot.

Run ``python main.py --dry-run`` to print the report without sending it.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping
from urllib.parse import quote

from report import (
    WINDOW_HOURS,
    ReportError,
    as_utc,
    build_report,
    fetch_samples,
)

#: Selects the delivery path. ``webhook`` is the default on purpose.
DELIVERY_MODE_ENV = "HOST_REPORT_DELIVERY"
DEFAULT_DELIVERY_MODE = "webhook"

#: Default Composio action and API base. Both are overridable so a renamed
#: action or a proxy does not need a code change.
COMPOSIO_ACTION_ENV = "COMPOSIO_DISCORD_ACTION"
DEFAULT_COMPOSIO_ACTION = "DISCORD_SEND_MESSAGE"
COMPOSIO_BASE_URL_ENV = "COMPOSIO_BASE_URL"
DEFAULT_COMPOSIO_BASE_URL = "https://backend.composio.dev"

#: Optional comma-separated host list for the report.
HOSTS_ENV = "HOST_REPORT_HOSTS"

#: Set to 1/true to print the report without delivering it.
DRY_RUN_ENV = "HOST_REPORT_DRY_RUN"

HTTP_TIMEOUT_SECONDS = 20
USER_AGENT = "rossmoney-host-report/1.0 (+https://github.com/tekkifox/rossmoney_me)"

PostJson = Callable[[str, bytes, Mapping[str, str]], tuple[int, str]]


class DeliveryError(RuntimeError):
    """The report could not be delivered. Safe to show in logs."""


def http_post_json(
    url: str, body: bytes, headers: Mapping[str, str]
) -> tuple[int, str]:
    """POST ``body`` and return ``(status, response text)``.

    ``urllib`` is used instead of a third-party HTTP client so the image needs
    only ``oracledb``. HTTP error responses are returned, not raised, so callers
    can include the status and a short body in their own error.
    """

    request = urllib.request.Request(
        url, data=body, headers=dict(headers), method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        raise DeliveryError(f"Could not reach {url}: {exc.reason}") from exc
    except OSError as exc:
        raise DeliveryError(f"Could not reach {url}: {exc}") from exc


def send_webhook(
    message: str,
    *,
    env: Mapping[str, str] | None = None,
    post: PostJson | None = None,
) -> int:
    """Post the report to a Discord webhook. Returns the HTTP status."""

    source = os.environ if env is None else env
    url = (source.get("DISCORD_WEBHOOK_URL") or "").strip()
    if not url:
        raise DeliveryError(
            "DISCORD_WEBHOOK_URL is not set; set it or use "
            "HOST_REPORT_DELIVERY=composio."
        )

    body = json.dumps({"content": message}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }
    status, text = (post or http_post_json)(url, body, headers)
    if not 200 <= status < 300:
        detail = text.strip()[:200]
        raise DeliveryError(
            f"Discord webhook returned HTTP {status}"
            + (f": {detail}" if detail else "")
        )
    return status


def send_composio(
    message: str,
    *,
    env: Mapping[str, str] | None = None,
    post: PostJson | None = None,
) -> int:
    """Send the report through Composio's action API. Returns the HTTP status.

    Secondary path: it needs a Discord *bot* connected in Composio. Composio's
    current Discord connection is user OAuth, which cannot post messages, so
    enabling this before a bot exists fails at Composio rather than here.
    """

    source = os.environ if env is None else env
    api_key = (source.get("COMPOSIO_API_KEY") or "").strip()
    channel_id = (source.get("DISCORD_CHANNEL_ID") or "").strip()
    missing = [
        name
        for name, value in (
            ("COMPOSIO_API_KEY", api_key),
            ("DISCORD_CHANNEL_ID", channel_id),
        )
        if not value
    ]
    if missing:
        raise DeliveryError(
            "Composio delivery needs " + ", ".join(missing) + "."
        )

    action = (
        source.get(COMPOSIO_ACTION_ENV) or DEFAULT_COMPOSIO_ACTION
    ).strip()
    base_url = (
        source.get(COMPOSIO_BASE_URL_ENV) or DEFAULT_COMPOSIO_BASE_URL
    ).rstrip("/")
    url = f"{base_url}/api/v2/actions/{quote(action, safe='')}/execute"

    payload: dict[str, Any] = {
        "input": {"channel_id": channel_id, "content": message}
    }
    connected_account = (source.get("COMPOSIO_CONNECTED_ACCOUNT_ID") or "").strip()
    if connected_account:
        payload["connected_account_id"] = connected_account

    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "User-Agent": USER_AGENT,
    }
    status, text = (post or http_post_json)(
        url, json.dumps(payload).encode("utf-8"), headers
    )
    if not 200 <= status < 300:
        detail = text.strip()[:200]
        raise DeliveryError(
            f"Composio action {action} returned HTTP {status}"
            + (f": {detail}" if detail else "")
        )

    try:
        parsed = json.loads(text) if text.strip() else None
    except ValueError:
        parsed = None
    if isinstance(parsed, dict) and parsed.get("successful") is False:
        error = parsed.get("error") or parsed.get("message") or "unknown error"
        raise DeliveryError(f"Composio action {action} failed: {error}")
    return status


def delivery_mode(env: Mapping[str, str] | None = None) -> str:
    source = os.environ if env is None else env
    return (source.get(DELIVERY_MODE_ENV) or DEFAULT_DELIVERY_MODE).strip().lower()


def deliver(
    message: str,
    *,
    env: Mapping[str, str] | None = None,
    post: PostJson | None = None,
) -> str:
    """Deliver ``message`` through the configured path. Returns the mode used."""

    mode = delivery_mode(env)
    if mode == "webhook":
        send_webhook(message, env=env, post=post)
    elif mode == "composio":
        send_composio(message, env=env, post=post)
    else:
        raise DeliveryError(
            f"{DELIVERY_MODE_ENV} must be 'webhook' or 'composio', got {mode!r}."
        )
    return mode


def _known_hosts(env: Mapping[str, str]) -> tuple[str, ...] | None:
    raw = env.get(HOSTS_ENV, "")
    hosts = tuple(host.strip() for host in raw.split(",") if host.strip())
    return hosts or None


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def run(
    *,
    env: Mapping[str, str] | None = None,
    now: datetime | None = None,
    fetch: Callable[[datetime], list[dict[str, Any]]] | None = None,
    deliver_fn: Callable[..., Any] | None = None,
    dry_run: bool = False,
) -> int:
    """Fetch one window, build one report, deliver once. Returns an exit code."""

    source = dict(os.environ) if env is None else dict(env)
    current = as_utc(now or datetime.now(timezone.utc))
    since = current - timedelta(hours=WINDOW_HOURS)

    if _truthy(source.get(DRY_RUN_ENV)):
        dry_run = True

    fetcher = fetch or (lambda start: fetch_samples(start, env=source))
    rows = fetcher(since)
    message = build_report(
        rows, now=current, known_hosts=_known_hosts(source)
    )

    print(message, flush=True)
    if dry_run:
        print("host-report: dry run, not delivered", flush=True)
        return 0

    sender = deliver_fn or deliver
    mode = sender(message, env=source)
    print(f"host-report: delivered via {mode}", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Send the daily host report.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the report but do not deliver it",
    )
    args = parser.parse_args(argv)

    try:
        return run(dry_run=args.dry_run)
    except (ReportError, DeliveryError) as exc:
        print(f"host-report failed: {exc}", file=sys.stderr, flush=True)
        return 1
    except Exception as exc:  # keep cron failures to one log line
        print(
            f"host-report failed unexpectedly: {type(exc).__name__}: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
