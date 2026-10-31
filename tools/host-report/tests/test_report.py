"""Unit tests for the report formatting and Oracle row fetching. No database."""

from __future__ import annotations

import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from report import (  # noqa: E402
    DISCORD_LIMIT,
    KNOWN_HOSTS,
    SAMPLES_SQL,
    ReportError,
    build_report,
    connection_params,
    fetch_samples,
)

NOW = datetime(2026, 10, 31, 9, 0, tzinfo=timezone.utc)

ENV = {
    "ORACLE_TNS_ADMIN": "/wallet",
    "ORACLE_USER": "ROSSMONEY",
    "ORACLE_PASSWORD": "not-a-real-password",
    "ORACLE_DSN": "rossadb_high",
}


def sample(
    host: str,
    minutes_ago: float,
    *,
    cpu: float = 20.0,
    memory: float = 40.0,
    load: float = 0.50,
    disk: float = 30.0,
    swap: float = 0.0,
) -> dict[str, Any]:
    sampled_at = NOW - timedelta(minutes=minutes_ago)
    return {
        "hostLabel": host,
        "sampledAt": sampled_at.isoformat().replace("+00:00", "Z"),
        "cpuAvg": cpu,
        "memoryPercent": memory,
        "loadAvg": load,
        "diskPercent": disk,
        "swapPercent": swap,
    }


class ReportFormatTests(unittest.TestCase):
    def test_all_healthy(self) -> None:
        rows = [
            sample(host, minutes_ago, cpu=20.0, memory=40.0, load=0.5, disk=30.0)
            for minutes_ago in (2, 5)
            for host in KNOWN_HOSTS
        ]

        message = build_report(rows, now=NOW)

        self.assertIn("**Host report**", message)
        self.assertIn("3/3 hosts reported, 0 stale, 0 flagged", message)
        self.assertNotIn("[!]", message)
        self.assertNotIn("STALE", message)
        for host in KNOWN_HOSTS:
            self.assertIn(f"- {host}: 2 samples", message)
        self.assertIn("CPU 20.0% avg / 20.0% peak", message)
        self.assertIn("mem 40.0% avg", message)
        self.assertIn("load 0.50 avg / 0.50 peak", message)
        self.assertIn("disk 30.0%", message)
        self.assertLessEqual(len(message), DISCORD_LIMIT)

    def test_one_stale_host(self) -> None:
        rows = [
            sample("rossmoney.me", 2),
            sample("vortexservers.co.uk", 3),
            # Older than 20 minutes but still inside the 24h window.
            sample("photos.rossmoney.me", 35),
        ]

        message = build_report(rows, now=NOW)

        self.assertIn("3/3 hosts reported, 1 stale, 1 flagged", message)
        self.assertIn(
            "- [!] photos.rossmoney.me: 1 sample, last-seen 35m ago", message
        )
        self.assertIn("STALE: no sample in the last 20m", message)
        self.assertNotIn("- [!] rossmoney.me", message)
        self.assertNotIn("- [!] vortexservers.co.uk", message)

    def test_host_missing_from_results_is_stale(self) -> None:
        rows = [sample("rossmoney.me", 2), sample("photos.rossmoney.me", 2)]

        message = build_report(rows, now=NOW)

        self.assertIn("2/3 hosts reported, 1 stale, 1 flagged", message)
        self.assertIn(
            "- [!] vortexservers.co.uk: no samples in the last 24h", message
        )

    def test_thresholds_are_inclusive_and_flagged(self) -> None:
        cases = (
            ("cpu", {"cpu": 90.0}, "CPU peak 90.0% >= 90%"),
            ("memory", {"memory": 90.0}, "memory 90.0% >= 90%"),
            ("load", {"load": 8.0}, "load peak 8.00 >= 8"),
            ("disk", {"disk": 90.0}, "disk 90.0% >= 90%"),
        )
        for name, values, expected in cases:
            with self.subTest(metric=name):
                message = build_report(
                    [sample("rossmoney.me", 2, **values)],
                    now=NOW,
                    known_hosts=("rossmoney.me",),
                )
                self.assertIn("- [!] rossmoney.me:", message)
                self.assertIn(expected, message)
                self.assertIn("1 flagged", message)

    def test_below_thresholds_is_not_flagged(self) -> None:
        message = build_report(
            [
                sample(
                    "rossmoney.me",
                    2,
                    cpu=89.9,
                    memory=89.9,
                    load=7.99,
                    disk=89.9,
                )
            ],
            now=NOW,
            known_hosts=("rossmoney.me",),
        )

        self.assertNotIn("[!]", message)
        self.assertIn("0 flagged", message)

    def test_empty_result_set(self) -> None:
        message = build_report([], now=NOW)

        self.assertIn("0/3 hosts reported, 3 stale, 3 flagged", message)
        for host in KNOWN_HOSTS:
            self.assertIn(f"- [!] {host}: no samples in the last 24h", message)
        self.assertEqual(message.count("STALE: no sample in the last 20m"), 3)

    def test_samples_outside_the_window_are_ignored(self) -> None:
        message = build_report(
            [sample("rossmoney.me", 25 * 60)],
            now=NOW,
            known_hosts=("rossmoney.me",),
        )

        self.assertIn("0/1 hosts reported, 1 stale", message)

    def test_long_age_is_human_readable(self) -> None:
        message = build_report(
            [sample("rossmoney.me", 200)],
            now=NOW,
            known_hosts=("rossmoney.me",),
        )

        self.assertIn("last-seen 3h 20m ago", message)

    def test_truncates_to_discord_limit(self) -> None:
        hosts = [f"host-{index:02d}.very-long-example-domain.test" for index in range(80)]
        rows = [sample(host, 2) for host in hosts]

        message = build_report(rows, now=NOW, known_hosts=hosts)

        self.assertLessEqual(len(message), DISCORD_LIMIT)
        self.assertIn("**Host report**", message)
        self.assertIn("truncated:", message)
        self.assertIn("host-00", message)
        self.assertNotIn("host-79", message)


class FakeCursor:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self.rows = rows
        self.executed: list[tuple[str, dict[str, Any]]] = []
        self.closed = False

    def execute(self, sql: str, params: dict[str, Any] | None = None) -> None:
        self.executed.append((sql, params or {}))

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self.rows

    def close(self) -> None:
        self.closed = True


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor
        self.closed = False
        self.connect_kwargs: dict[str, Any] = {}

    def cursor(self) -> FakeCursor:
        return self._cursor

    def close(self) -> None:
        self.closed = True


class FetchSamplesTests(unittest.TestCase):
    def test_binds_since_and_parses_json_documents(self) -> None:
        document = sample("rossmoney.me", 2)
        cursor = FakeCursor([(json.dumps(document),)])
        connections: list[FakeConnection] = []

        def factory(**kwargs: Any) -> FakeConnection:
            connection = FakeConnection(cursor)
            connection.connect_kwargs = kwargs
            connections.append(connection)
            return connection

        documents = fetch_samples(
            NOW - timedelta(hours=24), connection_factory=factory, env=ENV
        )

        self.assertEqual(documents, [document])
        self.assertEqual(cursor.executed, [(SAMPLES_SQL, {"since_iso": "2026-10-30T09:00:00Z"})])
        self.assertTrue(cursor.closed)
        self.assertTrue(connections[0].closed)
        self.assertEqual(connections[0].connect_kwargs["dsn"], "rossadb_high")
        self.assertEqual(connections[0].connect_kwargs["wallet_location"], "/wallet")

    def test_skips_non_json_rows(self) -> None:
        cursor = FakeCursor([("not json",), (json.dumps(sample("rossmoney.me", 2)),)])

        documents = fetch_samples(
            NOW - timedelta(hours=24),
            connection_factory=lambda **_: FakeConnection(cursor),
            env=ENV,
        )

        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0]["hostLabel"], "rossmoney.me")

    def test_connection_failure_is_short(self) -> None:
        def factory(**_: Any) -> None:
            raise OSError("network unreachable")

        with self.assertRaises(ReportError) as caught:
            fetch_samples(
                NOW - timedelta(hours=24), connection_factory=factory, env=ENV
            )

        self.assertIn("Could not connect", str(caught.exception))
        self.assertIn("rossadb_high", str(caught.exception))

    def test_missing_environment_names_the_variable(self) -> None:
        with self.assertRaises(ReportError) as caught:
            connection_params({"ORACLE_USER": "ROSSMONEY"})

        self.assertIn("ORACLE_TNS_ADMIN", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
