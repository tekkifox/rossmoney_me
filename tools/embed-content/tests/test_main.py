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
