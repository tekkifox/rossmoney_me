"""Unit tests for the Oracle search core. No database required."""

from __future__ import annotations

import json
import os
import sys
import unittest
from typing import Any
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import oracle_search  # noqa: E402
from oracle_search import (  # noqa: E402
    DEFAULT_LIMIT,
    MAX_LIMIT,
    SEARCH_SQL,
    SNIPPET_CHARS,
    SearchError,
    clamp_limit,
)

ENV = {
    "ORACLE_TNS_ADMIN": "/tmp/wallet",
    "ORACLE_USER": "ROSSMONEY",
    "ORACLE_PASSWORD": "not-a-real-password",
    "ORACLE_DSN": "rossadb_high",
}

LONG_CHUNK = '{"summary": "' + ("a long chunk of CMS JSON " * 40) + '"}'


class FakeCursor:
    def __init__(self, rows: list[tuple[Any, ...]] | None = None, error: Exception | None = None):
        self.rows = [] if rows is None else rows
        self.error = error
        self.executed: list[tuple[str, dict[str, Any]]] = []
        self.closed = False

    def execute(self, sql: str, params: dict[str, Any] | None = None) -> None:
        self.executed.append((sql, params or {}))
        if self.error is not None:
            raise self.error

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self.rows

    def close(self) -> None:
        self.closed = True


class FakeConnection:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor
        self.closed = False
        self.connect_kwargs: dict[str, Any] = {}

    def cursor(self) -> FakeCursor:
        return self._cursor

    def close(self) -> None:
        self.closed = True


def connection_factory_for(cursor: FakeCursor):
    connections: list[FakeConnection] = []

    def factory(**kwargs: Any) -> FakeConnection:
        connection = FakeConnection(cursor)
        connection.connect_kwargs = kwargs
        connections.append(connection)
        return connection

    return factory, connections


class ClampLimitTests(unittest.TestCase):
    def test_default_when_missing_or_not_numeric(self) -> None:
        self.assertEqual(clamp_limit(None), DEFAULT_LIMIT)
        self.assertEqual(clamp_limit("five"), DEFAULT_LIMIT)

    def test_numeric_string_is_accepted(self) -> None:
        self.assertEqual(clamp_limit("7"), 7)

    def test_zero_and_negative_are_raised_to_one(self) -> None:
        self.assertEqual(clamp_limit(0), 1)
        self.assertEqual(clamp_limit(-4), 1)

    def test_above_maximum_is_capped(self) -> None:
        self.assertEqual(clamp_limit(MAX_LIMIT + 1), MAX_LIMIT)
        self.assertEqual(clamp_limit(10_000), MAX_LIMIT)

    def test_values_inside_range_are_untouched(self) -> None:
        self.assertEqual(clamp_limit(1), 1)
        self.assertEqual(clamp_limit(5), 5)
        self.assertEqual(clamp_limit(MAX_LIMIT), MAX_LIMIT)


class SearchContentTests(unittest.TestCase):
    def test_query_and_limit_are_bound_not_concatenated(self) -> None:
        injection = "docker homelab'; DROP TABLE content_embeddings; --"
        cursor = FakeCursor(rows=[("page", "Home", "home", 0.123, "chunk text")])
        factory, connections = connection_factory_for(cursor)

        oracle_search.search_content(injection, 5, connection_factory=factory, env=ENV)

        self.assertEqual(len(connections), 1)
        self.assertEqual(len(cursor.executed), 1)
        sql, params = cursor.executed[0]
        self.assertIs(sql, SEARCH_SQL)
        self.assertNotIn(injection, sql)
        self.assertNotIn("docker homelab", sql)
        self.assertIn(":query_text", sql)
        self.assertIn(":max_rows", sql)
        self.assertEqual(params, {"query_text": injection, "max_rows": 5})

    def test_limit_is_clamped_before_binding(self) -> None:
        cursor = FakeCursor(rows=[])
        factory, _ = connection_factory_for(cursor)

        oracle_search.search_content("anything", 999, connection_factory=factory, env=ENV)

        self.assertEqual(cursor.executed[0][1]["max_rows"], MAX_LIMIT)

    def test_result_shape_is_the_promised_shape(self) -> None:
        cursor = FakeCursor(
            rows=[
                ("page", "Home", "home", 0.25, "short chunk"),
                ("experience", "Personal infrastructure", None, None, LONG_CHUNK),
            ]
        )
        factory, connections = connection_factory_for(cursor)

        results = oracle_search.search_content(
            "docker homelab", 2, connection_factory=factory, env=ENV
        )

        self.assertEqual(len(results), 2)
        for row in results:
            self.assertEqual(
                set(row), {"kind", "title", "slug", "distance", "snippet"}
            )
        self.assertEqual(results[0]["kind"], "page")
        self.assertEqual(results[0]["title"], "Home")
        self.assertEqual(results[0]["slug"], "home")
        self.assertIsInstance(results[0]["distance"], float)
        self.assertEqual(results[0]["distance"], 0.25)
        self.assertEqual(results[0]["snippet"], "short chunk")
        self.assertEqual(results[1]["slug"], "")
        self.assertIsNone(results[1]["distance"])
        self.assertLessEqual(len(results[1]["snippet"]), SNIPPET_CHARS)
        self.assertTrue(results[1]["snippet"].endswith("\u2026"))
        # Rows must be JSON-serialisable: that is what the MCP client receives.
        json.dumps(results)

        self.assertTrue(cursor.closed)
        self.assertTrue(connections[0].closed)

    def test_connection_uses_environment_values(self) -> None:
        cursor = FakeCursor(rows=[])
        factory, connections = connection_factory_for(cursor)

        oracle_search.search_content("x", 1, connection_factory=factory, env=ENV)

        self.assertEqual(
            connections[0].connect_kwargs,
            {
                "user": "ROSSMONEY",
                "password": "not-a-real-password",
                "dsn": "rossadb_high",
                "config_dir": "/tmp/wallet",
                "wallet_location": "/tmp/wallet",
            },
        )

    def test_unreachable_database_raises_clear_error(self) -> None:
        def factory(**kwargs: Any) -> Any:
            raise OSError("TNS: could not resolve the connect identifier")

        with self.assertRaises(SearchError) as caught:
            oracle_search.search_content(
                "docker homelab", 5, connection_factory=factory, env=ENV
            )

        message = str(caught.exception)
        self.assertIn("Could not connect to Oracle", message)
        self.assertIn("rossadb_high", message)
        self.assertIn("could not resolve", message)
        self.assertNotIn("not-a-real-password", message)

    def test_query_failure_is_reported_and_connection_closed(self) -> None:
        cursor = FakeCursor(error=RuntimeError("ORA-00942: table or view does not exist"))
        factory, connections = connection_factory_for(cursor)

        with self.assertRaises(SearchError) as caught:
            oracle_search.search_content(
                "docker homelab", 5, connection_factory=factory, env=ENV
            )

        self.assertIn("Oracle search failed", str(caught.exception))
        self.assertIn("ORA-00942", str(caught.exception))
        self.assertTrue(connections[0].closed)

    def test_missing_environment_names_the_variables(self) -> None:
        def factory(**kwargs: Any) -> Any:  # pragma: no cover - must not run
            raise AssertionError("connection must not be attempted")

        partial = {"ORACLE_USER": "ROSSMONEY", "ORACLE_PASSWORD": "x", "ORACLE_DSN": "y"}

        with self.assertRaises(SearchError) as caught:
            oracle_search.search_content(
                "docker homelab", 5, connection_factory=factory, env=partial
            )

        self.assertIn("ORACLE_TNS_ADMIN", str(caught.exception))

    def test_blank_query_is_rejected_before_connecting(self) -> None:
        def factory(**kwargs: Any) -> Any:  # pragma: no cover - must not run
            raise AssertionError("connection must not be attempted")

        with self.assertRaises(SearchError):
            oracle_search.search_content("   ", 5, connection_factory=factory, env=ENV)


class McpToolTests(unittest.TestCase):
    def test_tool_wraps_search_error_without_a_traceback(self) -> None:
        try:
            import server
        except ModuleNotFoundError:  # pragma: no cover - mcp not installed
            self.skipTest("mcp SDK is not installed")

        from mcp.server.mcpserver.exceptions import ToolError

        with mock.patch.object(
            server, "search_content", side_effect=SearchError("database is down")
        ):
            with self.assertRaises(ToolError) as caught:
                server.search_content_tool("docker homelab", 5)

        self.assertEqual(str(caught.exception), "database is down")


if __name__ == "__main__":
    unittest.main()
