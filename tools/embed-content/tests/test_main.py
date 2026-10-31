"""Unit tests for the ingest orchestration. No database required."""

from __future__ import annotations

import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402
from main import (  # noqa: E402
    ExistingDocument,
    build_existing_index,
    decode_document,
    load_documents,
    parse_row_id,
    print_plan,
    should_skip,
)

DOC = {
    "_id": "6adbb444cdb0a4642ab152da",
    "updatedAt": "2026-10-31T00:15:22.968000Z",
}

CHUNKS = [("lead", "Some prose."), ("focus", "More prose.")]


class ParseRowIdTests(unittest.TestCase):
    def test_new_chunk_ids_lose_the_ordinal(self) -> None:
        self.assertEqual(parse_row_id("page:abc#1"), "page:abc")
        self.assertEqual(parse_row_id("experience:abc#12"), "experience:abc")

    def test_legacy_ids_are_unchanged(self) -> None:
        self.assertEqual(parse_row_id("page:abc"), "page:abc")
        self.assertEqual(parse_row_id("project:abc#not-a-number"), "project:abc#not-a-number")


class FakeCursor:
    """Cursor that returns the rows registered for each source table."""

    def __init__(self, rows_by_table: dict[str, list[tuple[object, ...]]]):
        self.rows_by_table = rows_by_table
        self.sql = ""

    def execute(self, sql: str, params: object | None = None) -> None:
        self.sql = sql

    def fetchall(self) -> list[tuple[object, ...]]:
        for table, rows in self.rows_by_table.items():
            if f'"{table}"' in self.sql:
                return rows
        return []


class LoadDocumentTests(unittest.TestCase):
    def test_decoded_json_value_is_not_stringified_and_reparsed(self) -> None:
        cursor = FakeCursor(
            {
                "pages": [
                    (
                        {
                            "_id": "home",
                            "title": "Decoded by the driver",
                            "updatedAt": "2026-01-01",
                        },
                    )
                ],
                "projects": [],
                "experiences": [],
            }
        )

        documents = load_documents(cursor)

        self.assertEqual(len(documents), 1)
        kind, doc = documents[0]
        self.assertEqual(kind, "page")
        self.assertEqual(doc["title"], "Decoded by the driver")

    def test_bytes_are_decoded_and_parsed_as_json(self) -> None:
        cursor = FakeCursor(
            {
                "pages": [],
                "projects": [
                    (
                        b'{"_id": "morphsites", "title": "Bytes", '
                        b'"updatedAt": "2026-01-01"}',
                    )
                ],
                "experiences": [],
            }
        )

        documents = load_documents(cursor)

        self.assertEqual(len(documents), 1)
        kind, doc = documents[0]
        self.assertEqual(kind, "project")
        self.assertEqual(doc["title"], "Bytes")

    def test_decode_document_handles_a_lob_like_value(self) -> None:
        class LOB:
            def read(self) -> str:
                return '{"_id": "lob", "title": "LOB"}'

        self.assertEqual(decode_document(LOB())["title"], "LOB")

    def test_both_driver_shapes_can_arrive_in_one_run(self) -> None:
        cursor = FakeCursor(
            {
                "pages": [({"_id": "p", "title": "dict"},)],
                "projects": [(b'{"_id": "j", "title": "bytes"}',)],
                "experiences": [({"_id": "e", "title": "dict again"},)],
            }
        )

        documents = load_documents(cursor)

        self.assertEqual(
            [(kind, doc["title"]) for kind, doc in documents],
            [
                ("page", "dict"),
                ("project", "bytes"),
                ("experience", "dict again"),
            ],
        )


class ExistingIndexTests(unittest.TestCase):
    def test_rows_are_grouped_and_counted(self) -> None:
        index = build_existing_index(
            [
                ("page:abc#1", "page", "2026-01-01"),
                ("page:abc#2", "page", "2026-01-01"),
                ("page:def", "page", "2026-01-02"),
            ]
        )
        self.assertEqual(index["page:abc"].count, 2)
        self.assertEqual(index["page:abc"].versions, {"2026-01-01"})
        self.assertEqual(index["page:def"].count, 1)


class SkipTests(unittest.TestCase):
    def test_unchanged_document_is_skipped(self) -> None:
        existing = {
            "page:6adbb444cdb0a4642ab152da": ExistingDocument(
                count=2, versions={"2026-10-31T00:15:22.968000Z"}
            )
        }
        self.assertTrue(should_skip("page", DOC, CHUNKS, existing))

    def test_changed_updated_at_is_not_skipped(self) -> None:
        existing = {
            "page:6adbb444cdb0a4642ab152da": ExistingDocument(
                count=2, versions={"2026-10-30T23:21:06.580000Z"}
            )
        }
        self.assertFalse(should_skip("page", DOC, CHUNKS, existing))

    def test_changed_chunk_count_is_not_skipped(self) -> None:
        existing = {
            "page:6adbb444cdb0a4642ab152da": ExistingDocument(
                count=1, versions={"2026-10-31T00:15:22.968000Z"}
            )
        }
        self.assertFalse(should_skip("page", DOC, CHUNKS, existing))

    def test_missing_rows_are_not_skipped(self) -> None:
        self.assertFalse(should_skip("page", DOC, CHUNKS, {}))

    def test_object_id_bytes_are_hex_encoded_for_row_ids(self) -> None:
        raw_id = bytes.fromhex("6adbb444cdb0a4642ab152da")
        doc = {
            "_id": raw_id,
            "updatedAt": "2026-10-31T00:15:22.968000Z",
        }
        existing = {
            "page:6adbb444cdb0a4642ab152da": ExistingDocument(
                count=2, versions={"2026-10-31T00:15:22.968000Z"}
            )
        }
        self.assertTrue(should_skip("page", doc, CHUNKS, existing))

    def test_empty_document_with_no_rows_needs_no_work(self) -> None:
        self.assertTrue(should_skip("page", DOC, [], {}))

    def test_empty_document_with_stale_rows_is_not_skipped(self) -> None:
        existing = {
            "page:6adbb444cdb0a4642ab152da": ExistingDocument(
                count=1, versions={"2026-10-31T00:15:22.968000Z"}
            )
        }
        self.assertFalse(should_skip("page", DOC, [], existing))


class PlanPrintTests(unittest.TestCase):
    def test_plan_names_sections_and_lengths(self) -> None:
        output = io.StringIO()
        print_plan("page", DOC, CHUNKS, output)
        printed = output.getvalue()
        self.assertIn("write page:6adbb444cdb0a4642ab152da", printed)
        self.assertIn("lead", printed)
        self.assertIn("focus", printed)
        self.assertIn("Some prose.", printed)


if __name__ == "__main__":
    unittest.main()
