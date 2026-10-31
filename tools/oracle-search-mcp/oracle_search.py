"""Semantic search over the CMS content stored in Oracle.

The query text is embedded in-database with ``ADMIN.embed_text`` so no external
embedding API is involved. This module has no MCP dependency: ``server.py``
wraps :func:`search_content` as an MCP tool, and the unit tests exercise it with
a fake Oracle connection.
"""

from __future__ import annotations

import os
from typing import Any, Callable, Mapping

import oracledb

#: Hard ceiling for rows returned by one search.
MAX_LIMIT = 20
#: Limit used when the caller's limit is missing or not an integer.
DEFAULT_LIMIT = 5
#: Number of characters of the stored chunk returned as ``snippet``.
SNIPPET_CHARS = 240

#: The only SQL this module runs. Both the query text and the row count are
#: bind variables; user input is never concatenated into this string.
SEARCH_SQL = """
SELECT kind, title, slug, dist, chunk
FROM (
    SELECT kind, title, slug, chunk,
           ROUND(
               VECTOR_DISTANCE(embedding, ADMIN.embed_text(:query_text), COSINE),
               3
           ) AS dist
    FROM ROSSMONEY.content_embeddings
    ORDER BY dist
)
WHERE ROWNUM <= :max_rows
"""

ENV_VARS = ("ORACLE_TNS_ADMIN", "ORACLE_USER", "ORACLE_PASSWORD", "ORACLE_DSN")

#: Optional: password for an encrypted wallet (``ewallet.pem``). Most downloaded
#: Autonomous Database wallets do not need it, so it is not required.
WALLET_PASSWORD_ENV = "ORACLE_WALLET_PASSWORD"

ConnectionFactory = Callable[..., Any]


class SearchError(RuntimeError):
    """A search could not be performed. The message is safe to show a user."""


def clamp_limit(limit: Any) -> int:
    """Return ``limit`` as an int between 1 and :data:`MAX_LIMIT`.

    A missing or non-numeric limit falls back to :data:`DEFAULT_LIMIT`; numeric
    values are clamped rather than rejected so clients cannot ask for an
    unbounded result set.
    """

    try:
        value = int(limit)
    except (TypeError, ValueError):
        return DEFAULT_LIMIT
    return max(1, min(value, MAX_LIMIT))


def connection_params(env: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Build ``oracledb.connect`` keyword arguments from the environment.

    Credentials are never defaulted or hard-coded. Raises :class:`SearchError`
    naming any missing variables.
    """

    source = os.environ if env is None else env
    missing = [name for name in ENV_VARS if not source.get(name)]
    if missing:
        raise SearchError(
            "Missing Oracle connection environment variable(s): "
            + ", ".join(missing)
            + ". See tools/oracle-search-mcp/README.md."
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


def _as_text(value: Any) -> str:
    """Normalise a driver value (str, bytes or LOB) to a string."""

    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", errors="replace")
    read = getattr(value, "read", None)
    if callable(read):
        return _as_text(read())
    return str(value)


def _snippet(chunk: Any, size: int = SNIPPET_CHARS) -> str:
    text = _as_text(chunk)
    if len(text) <= size:
        return text
    return text[: size - 1] + "\u2026"


def search_content(
    query: str,
    limit: int = DEFAULT_LIMIT,
    *,
    connection_factory: ConnectionFactory | None = None,
    env: Mapping[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Return the closest content chunks to ``query``, nearest first.

    Each row is ``{"kind", "title", "slug", "distance", "snippet"}``.

    Raises :class:`SearchError` with a human-readable message when the query is
    blank, configuration is incomplete, or Oracle cannot be reached or queried.
    """

    text = (query or "").strip()
    if not text:
        raise SearchError("query must be a non-empty string")

    params = connection_params(env)
    max_rows = clamp_limit(limit)
    factory = connection_factory or oracledb.connect

    try:
        connection = factory(**params)
    except Exception as exc:  # driver errors, timeouts, bad wallet, ...
        raise SearchError(
            f"Could not connect to Oracle DSN {params['dsn']!r}: {exc}"
        ) from exc

    try:
        cursor = connection.cursor()
        try:
            cursor.execute(
                SEARCH_SQL, {"query_text": text, "max_rows": max_rows}
            )
            rows = cursor.fetchall()
        finally:
            cursor.close()
    except SearchError:
        raise
    except Exception as exc:
        raise SearchError(f"Oracle search failed: {exc}") from exc
    finally:
        try:
            connection.close()
        except Exception:
            pass

    return [
        {
            "kind": _as_text(row[0]),
            "title": _as_text(row[1]),
            "slug": _as_text(row[2]),
            "distance": None if row[3] is None else float(row[3]),
            "snippet": _snippet(row[4]),
        }
        for row in rows
    ]
