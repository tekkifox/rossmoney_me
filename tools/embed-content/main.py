#!/usr/bin/env python3
"""Embed CMS documents into Oracle as readable section chunks.

The script reads ``ROSSMONEY."pages"``, ``"projects"`` and ``"experiences"``
(MongoDB-compatible JSON documents in a ``data`` column), chunks each document
with :mod:`chunker`, and writes one row per chunk to
``ROSSMONEY.content_embeddings``.

It is intentionally incremental: a document is skipped when its stored
``source_updated`` still matches ``updatedAt`` and the number of rows matches the
number of chunks the current document would produce.

Run with ``--dry-run`` to print the plan without writing anything.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping, TextIO

from chunker import MAX_SECTION_CHARS, chunk_document

#: The tables and the ``kind`` value each one maps to.
TABLES: tuple[tuple[str, str], ...] = (
    ("page", "pages"),
    ("project", "projects"),
    ("experience", "experiences"),
)

ENV_VARS = ("ORACLE_TNS_ADMIN", "ORACLE_USER", "ORACLE_PASSWORD", "ORACLE_DSN")

#: Optional password for an encrypted wallet (``ewallet.pem``).
WALLET_PASSWORD_ENV = "ORACLE_WALLET_PASSWORD"

EMBEDDINGS_TABLE = "ROSSMONEY.content_embeddings"

INSERT_SQL = """
INSERT INTO ROSSMONEY.content_embeddings
    (id, kind, slug, title, chunk, embedding, source_updated, section)
SELECT :id, :kind, :slug, :title, :chunk,
       ADMIN.embed_text(:chunk), :source_updated, :section
FROM dual
"""

DELETE_SQL = """
DELETE FROM ROSSMONEY.content_embeddings
WHERE id = :base OR id LIKE :prefix
"""

EXISTING_SQL = """
SELECT id, kind, source_updated
FROM ROSSMONEY.content_embeddings
"""

SECTION_COLUMN_SQL = """
SELECT COUNT(*)
FROM all_tab_columns
WHERE owner = 'ROSSMONEY'
  AND table_name = 'CONTENT_EMBEDDINGS'
  AND column_name = 'SECTION'
"""

ConnectionFactory = Callable[..., Any]


class IngestError(RuntimeError):
    """A configuration or database problem with a short, safe message."""


@dataclass
class ExistingDocument:
    """Rows already stored for one document."""

    count: int = 0
    versions: set[str] = field(default_factory=set)


@dataclass
class Summary:
    scanned: int = 0
    skipped: int = 0
    documents_written: int = 0
    chunks_written: int = 0
    section_column_added: bool = False
    dry_run: bool = False


def connection_params(env: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Build ``oracledb.connect`` keyword arguments from the environment."""

    source = os.environ if env is None else env
    missing = [name for name in ENV_VARS if not source.get(name)]
    if missing:
        raise IngestError(
            "Missing Oracle connection environment variable(s): "
            + ", ".join(missing)
            + ". See tools/embed-content/README.md."
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


def connect(
    env: Mapping[str, str] | None = None,
    connection_factory: ConnectionFactory | None = None,
) -> Any:
    """Open an ``oracledb`` thin-mode connection."""

    params = connection_params(env)
    if connection_factory is None:
        try:
            import oracledb  # imported lazily so unit tests need no driver
        except ModuleNotFoundError as exc:  # pragma: no cover - environment
            raise IngestError(
                "oracledb is not installed. See tools/embed-content/README.md."
            ) from exc
        connection_factory = oracledb.connect

    try:
        return connection_factory(**params)
    except Exception as exc:  # driver errors, bad wallet, ...
        raise IngestError(
            f"Could not connect to Oracle DSN {params['dsn']!r}: {exc}"
        ) from exc


def _as_text(value: Any) -> str:
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


def decode_document(value: Any) -> Any:
    """Return a document from a driver column without double-encoding it.

    ``python-oracledb`` may hand back a JSON column as an already-decoded
    ``dict``/``list``. Older drivers and CLOB columns return ``str``, ``bytes``
    or a LOB. Calling ``json.loads`` on ``str(dict)`` is invalid JSON, so only
    strings are parsed here.
    """

    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray)):
        text = bytes(value).decode("utf-8", errors="replace")
    elif isinstance(value, str):
        text = value
    else:
        read = getattr(value, "read", None)
        text = _as_text(read()) if callable(read) else _as_text(value)
    return json.loads(text)


def _updated_at(doc: Mapping[str, Any]) -> str:
    value = doc.get("updatedAt")
    return "" if value is None else str(value)


def _doc_id(doc: Mapping[str, Any]) -> str:
    value = doc.get("_id", doc.get("id", ""))
    if value is None:
        return ""
    if isinstance(value, (bytes, bytearray)):
        raw = bytes(value)
        try:
            text = raw.decode("ascii")
        except UnicodeDecodeError:
            return raw.hex()
        # Mongo ObjectIds arrive as 12 raw bytes; printable ids stay as text.
        if text and all(32 <= ord(character) < 127 for character in text):
            return text
        return raw.hex()
    return str(value)


def _base_id(kind: str, doc_id: str) -> str:
    return f"{kind}:{doc_id}"


def parse_row_id(row_id: str) -> str:
    """Return ``kind:docId`` for both new (``#n``) and legacy row ids."""

    base, separator, suffix = row_id.rpartition("#")
    if separator and suffix.isdigit():
        return base
    return row_id


def build_existing_index(
    rows: Iterable[tuple[Any, Any, Any]],
) -> dict[str, ExistingDocument]:
    """Group stored embedding rows by ``kind:docId``."""

    index: dict[str, ExistingDocument] = {}
    for row in rows:
        row_id = _as_text(row[0])
        kind = _as_text(row[1])
        version = _as_text(row[2])
        key = parse_row_id(row_id)
        entry = index.setdefault(key, ExistingDocument())
        entry.count += 1
        entry.versions.add(version)
    return index


def should_skip(
    kind: str,
    doc: Mapping[str, Any],
    chunks: list[tuple[str, str]],
    existing: Mapping[str, ExistingDocument],
) -> bool:
    """True when the stored rows already match this document exactly."""

    doc_id = _doc_id(doc)
    if not doc_id:
        return False

    entry = existing.get(_base_id(kind, doc_id))
    if not chunks and entry is None:
        # Nothing to delete and nothing to write.
        return True
    if entry is None or entry.count != len(chunks):
        return False
    return entry.versions == {_updated_at(doc)}


def load_documents(cursor: Any) -> list[tuple[str, dict[str, Any]]]:
    documents: list[tuple[str, dict[str, Any]]] = []
    for kind, table in TABLES:
        cursor.execute(f'SELECT data FROM ROSSMONEY."{table}"')
        for row in cursor.fetchall():
            try:
                doc = decode_document(row[0])
            except json.JSONDecodeError as exc:
                raise IngestError(
                    f"Could not parse a document from ROSSMONEY.\"{table}\": {exc}"
                ) from exc
            if isinstance(doc, dict):
                documents.append((kind, doc))
    return documents


def load_existing(cursor: Any) -> dict[str, ExistingDocument]:
    cursor.execute(EXISTING_SQL)
    return build_existing_index(cursor.fetchall())


def ensure_section_column(cursor: Any, dry_run: bool) -> bool:
    """Add ``section VARCHAR2(64)`` when it is missing.

    Returns True when the column is missing (and, outside dry-run, was added).
    """

    cursor.execute(SECTION_COLUMN_SQL)
    row = cursor.fetchone()
    if row and int(row[0]) > 0:
        return False
    if dry_run:
        return True
    try:
        cursor.execute(
            f"ALTER TABLE {EMBEDDINGS_TABLE} ADD (section VARCHAR2(64))"
        )
    except Exception as exc:  # pragma: no cover - needs a real database
        raise IngestError(
            "ROSSMONEY.content_embeddings has no SECTION column and it could "
            f"not be added: {exc}"
        ) from exc
    return True


def delete_document_rows(cursor: Any, kind: str, doc_id: str) -> None:
    base = _base_id(kind, doc_id)
    cursor.execute(DELETE_SQL, {"base": base, "prefix": f"{base}#%"})


def write_document(
    cursor: Any,
    kind: str,
    doc: Mapping[str, Any],
    chunks: list[tuple[str, str]],
) -> None:
    """Replace one document's rows with one row per chunk."""

    doc_id = _doc_id(doc)
    base = _base_id(kind, doc_id)
    delete_document_rows(cursor, kind, doc_id)

    slug = _as_text(doc.get("slug"))[:200]
    title = _as_text(doc.get("title"))[:400]
    source_updated = _updated_at(doc)[:64]

    for number, (section, text) in enumerate(chunks, start=1):
        cursor.execute(
            INSERT_SQL,
            {
                "id": f"{base}#{number}"[:80],
                "kind": kind[:24],
                "slug": slug,
                "title": title,
                "chunk": text,
                "source_updated": source_updated,
                "section": section[:MAX_SECTION_CHARS],
            },
        )


def _preview(text: str, width: int = 84) -> str:
    return text if len(text) <= width else text[: width - 1] + "\u2026"


def print_plan(
    kind: str,
    doc: Mapping[str, Any],
    chunks: list[tuple[str, str]],
    output: TextIO,
) -> None:
    print(f"write {kind}:{_doc_id(doc)} ({len(chunks)} chunks)", file=output)
    for section, text in chunks:
        print(
            f"  {section:<22} {len(text):>4}  {_preview(text)}",
            file=output,
        )


def run(
    connection: Any,
    dry_run: bool = False,
    output: TextIO = sys.stdout,
) -> Summary:
    """Chunk, embed and store every CMS document. Returns a summary."""

    summary = Summary(dry_run=dry_run)
    cursor = connection.cursor()
    try:
        summary.section_column_added = ensure_section_column(cursor, dry_run)
        if summary.section_column_added:
            if dry_run:
                print(
                    "Would add the missing section VARCHAR2(64) column.",
                    file=output,
                )
            else:
                print("Added the missing section VARCHAR2(64) column.", file=output)

        documents = load_documents(cursor)
        existing = load_existing(cursor)

        for kind, doc in documents:
            summary.scanned += 1
            doc_id = _doc_id(doc)
            if not doc_id:
                raise IngestError(
                    f"A {kind} document has no _id; refusing to guess its row id."
                )

            chunks = chunk_document(doc, kind)
            if should_skip(kind, doc, chunks, existing):
                summary.skipped += 1
                print(f"skip  {kind}:{doc_id} (unchanged)", file=output)
                continue

            if dry_run:
                print_plan(kind, doc, chunks, output)
                summary.documents_written += 1
                summary.chunks_written += len(chunks)
                continue

            write_document(cursor, kind, doc, chunks)
            connection.commit()
            summary.documents_written += 1
            summary.chunks_written += len(chunks)
            print(
                f"write {kind}:{doc_id} ({len(chunks)} chunks)",
                file=output,
            )
    finally:
        cursor.close()

    return summary


def print_summary(summary: Summary, output: TextIO = sys.stdout) -> None:
    print("", file=output)
    print(f"Documents scanned: {summary.scanned}", file=output)
    print(f"Documents skipped (unchanged): {summary.skipped}", file=output)
    if summary.dry_run:
        print(
            "Documents that would be written: "
            f"{summary.documents_written}",
            file=output,
        )
        print(
            "Chunks that would be written: "
            f"{summary.chunks_written}",
            file=output,
        )
        print("Chunks written: 0 (dry run)", file=output)
    else:
        print(
            f"Documents written: {summary.documents_written}",
            file=output,
        )
        print(f"Chunks written: {summary.chunks_written}", file=output)


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Chunk the ross.money CMS documents into readable sections and "
            "embed them into ROSSMONEY.content_embeddings."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print what would be written without changing the database",
    )
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        connection = connect()
    except IngestError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    try:
        summary = run(connection, dry_run=args.dry_run)
    except IngestError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # keep the CLI failure short and actionable
        print(f"error: embedding failed: {exc}", file=sys.stderr)
        return 1
    finally:
        try:
            connection.close()
        except Exception:
            pass

    print_summary(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
