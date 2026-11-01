"""Unit tests for webhook and Composio delivery. No network calls."""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import (  # noqa: E402
    DEFAULT_COMPOSIO_ACTION,
    DeliveryError,
    deliver,
    delivery_mode,
    run,
    send_composio,
    send_webhook,
)

NOW = datetime(2026, 10, 31, 9, 0, tzinfo=timezone.utc)
WEBHOOK = "https://discord.example/api/webhooks/1/token"
MESSAGE = "**Host report**\n- rossmoney.me: healthy"


class PostRecorder:
    def __init__(self, status: int = 204, body: str = "") -> None:
        self.status = status
        self.body = body
        self.calls: list[tuple[str, bytes, Mapping[str, str]]] = []

    def __call__(
        self, url: str, body: bytes, headers: Mapping[str, str]
    ) -> tuple[int, str]:
        self.calls.append((url, body, headers))
        return self.status, self.body


class WebhookTests(unittest.TestCase):
    def test_posts_discord_content_payload(self) -> None:
        post = PostRecorder(status=204)

        status = send_webhook(MESSAGE, env={"DISCORD_WEBHOOK_URL": WEBHOOK}, post=post)

        self.assertEqual(status, 204)
        url, body, headers = post.calls[0]
        self.assertEqual(url, WEBHOOK)
        self.assertEqual(json.loads(body), {"content": MESSAGE})
        self.assertEqual(headers["Content-Type"], "application/json")

    def test_non_2xx_is_an_error_with_status(self) -> None:
        post = PostRecorder(status=429, body="rate limited")

        with self.assertRaises(DeliveryError) as caught:
            send_webhook(
                MESSAGE, env={"DISCORD_WEBHOOK_URL": WEBHOOK}, post=post
            )

        self.assertIn("HTTP 429", str(caught.exception))
        self.assertIn("rate limited", str(caught.exception))

    def test_missing_url_is_an_error(self) -> None:
        with self.assertRaises(DeliveryError) as caught:
            send_webhook(MESSAGE, env={}, post=PostRecorder())

        self.assertIn("DISCORD_WEBHOOK_URL", str(caught.exception))


class ComposioTests(unittest.TestCase):
    def test_posts_action_with_channel_and_content(self) -> None:
        post = PostRecorder(status=200, body='{"successful": true}')

        status = send_composio(
            MESSAGE,
            env={
                "COMPOSIO_API_KEY": "test-key",
                "DISCORD_CHANNEL_ID": "123456789",
                "COMPOSIO_CONNECTED_ACCOUNT_ID": "account-1",
            },
            post=post,
        )

        self.assertEqual(status, 200)
        url, body, headers = post.calls[0]
        self.assertEqual(
            url,
            "https://backend.composio.dev/api/v2/actions/"
            f"{DEFAULT_COMPOSIO_ACTION}/execute",
        )
        self.assertEqual(headers["x-api-key"], "test-key")
        payload = json.loads(body)
        self.assertEqual(
            payload["input"], {"channel_id": "123456789", "content": MESSAGE}
        )
        self.assertEqual(payload["connected_account_id"], "account-1")

    def test_action_and_base_url_are_configurable(self) -> None:
        post = PostRecorder()

        send_composio(
            MESSAGE,
            env={
                "COMPOSIO_API_KEY": "test-key",
                "DISCORD_CHANNEL_ID": "123",
                "COMPOSIO_DISCORD_ACTION": "CUSTOM_ACTION",
                "COMPOSIO_BASE_URL": "https://composio.example/",
            },
            post=post,
        )

        self.assertEqual(
            post.calls[0][0],
            "https://composio.example/api/v2/actions/CUSTOM_ACTION/execute",
        )

    def test_missing_variables_are_named(self) -> None:
        with self.assertRaises(DeliveryError) as caught:
            send_composio(MESSAGE, env={"COMPOSIO_API_KEY": "test-key"})

        self.assertIn("DISCORD_CHANNEL_ID", str(caught.exception))

    def test_successful_false_is_an_error(self) -> None:
        post = PostRecorder(
            status=200, body='{"successful": false, "error": "no connected account"}'
        )

        with self.assertRaises(DeliveryError) as caught:
            send_composio(
                MESSAGE,
                env={
                    "COMPOSIO_API_KEY": "test-key",
                    "DISCORD_CHANNEL_ID": "123",
                },
                post=post,
            )

        self.assertIn("no connected account", str(caught.exception))


class DeliveryChoiceTests(unittest.TestCase):
    def test_webhook_is_the_default(self) -> None:
        self.assertEqual(delivery_mode({}), "webhook")

    def test_unknown_mode_is_rejected(self) -> None:
        with self.assertRaises(DeliveryError) as caught:
            deliver(MESSAGE, env={"HOST_REPORT_DELIVERY": "carrier-pigeon"})

        self.assertIn("HOST_REPORT_DELIVERY", str(caught.exception))

    def test_composio_flag_selects_composio(self) -> None:
        post = PostRecorder()
        mode = deliver(
            MESSAGE,
            env={
                "HOST_REPORT_DELIVERY": "composio",
                "COMPOSIO_API_KEY": "test-key",
                "DISCORD_CHANNEL_ID": "123",
            },
            post=post,
        )

        self.assertEqual(mode, "composio")
        self.assertIn("/actions/", post.calls[0][0])


class RunTests(unittest.TestCase):
    def _rows(self) -> list[dict[str, Any]]:
        return [
            {
                "hostLabel": "rossmoney.me",
                "sampledAt": (NOW - timedelta(minutes=2))
                .isoformat()
                .replace("+00:00", "Z"),
                "cpuAvg": 20,
                "memoryPercent": 40,
                "loadAvg": 0.5,
                "diskPercent": 30,
            }
        ]

    def test_runs_once_and_delivers(self) -> None:
        recorded: list[tuple[str, Mapping[str, str]]] = []

        def deliver_fn(message: str, *, env: Mapping[str, str]) -> str:
            recorded.append((message, env))
            return "webhook"

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = run(
                env={"HOST_REPORT_HOSTS": "rossmoney.me"},
                now=NOW,
                fetch=lambda since: self._rows(),
                deliver_fn=deliver_fn,
            )

        self.assertEqual(code, 0)
        self.assertEqual(len(recorded), 1)
        self.assertIn("**Host report**", recorded[0][0])
        self.assertIn("1/1 hosts reported", recorded[0][0])
        self.assertIn("delivered via webhook", output.getvalue())

    def test_dry_run_does_not_deliver(self) -> None:
        def deliver_fn(message: str, *, env: Mapping[str, str]) -> str:
            raise AssertionError("dry run must not deliver")

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = run(
                env={"HOST_REPORT_HOSTS": "rossmoney.me"},
                now=NOW,
                fetch=lambda since: self._rows(),
                deliver_fn=deliver_fn,
                dry_run=True,
            )

        self.assertEqual(code, 0)
        self.assertIn("dry run, not delivered", output.getvalue())

    def test_env_dry_run_does_not_deliver(self) -> None:
        def deliver_fn(message: str, *, env: Mapping[str, str]) -> str:
            raise AssertionError("HOST_REPORT_DRY_RUN must not deliver")

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = run(
                env={
                    "HOST_REPORT_HOSTS": "rossmoney.me",
                    "HOST_REPORT_DRY_RUN": "1",
                },
                now=NOW,
                fetch=lambda since: self._rows(),
                deliver_fn=deliver_fn,
            )

        self.assertEqual(code, 0)
        self.assertIn("dry run, not delivered", output.getvalue())


if __name__ == "__main__":
    unittest.main()
