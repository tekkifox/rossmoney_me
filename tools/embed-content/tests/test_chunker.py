"""Unit tests for the pure chunking logic. No database required."""

from __future__ import annotations

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chunker import (  # noqa: E402
    MAX_CHUNK_CHARS,
    MAX_CHUNKS,
    MAX_SECTION_CHARS,
    chunk_document,
)


def text_node(text: str) -> dict:
    return {"type": "text", "text": text, "format": 0, "version": 1}


def rich_text(*blocks: dict) -> dict:
    return {
        "root": {
            "type": "root",
            "children": list(blocks),
            "direction": "ltr",
            "format": "",
            "indent": 0,
            "version": 1,
        }
    }


def heading(text: str, tag: str = "h2") -> dict:
    return {
        "type": "heading",
        "tag": tag,
        "children": [text_node(text)],
        "version": 1,
    }


def paragraph(text: str) -> dict:
    return {
        "type": "paragraph",
        "children": [text_node(text)],
        "version": 1,
    }


PAGE = {
    "_id": "6adbb444cdb0a4642ab152da",
    "title": "Building dependable systems with operational discipline.",
    "eyebrow": "Available for devops and developer roles",
    "lead": (
        "I design and ship resilient developer experiences, automation "
        "layers, and production-ready interfaces."
    ),
    "focus": {
        "kicker": "Current focus",
        "title": "Building personal infrastructure",
        "status": "Live",
        "items": [
            {
                "label": "Role",
                "value": "DevOps-focused developer working on personal projects",
            },
            {
                "label": "Specialty",
                "value": "Storage servers, media servers, and self-hosted services",
            },
        ],
    },
    "meta": {
        "title": "Home",
        "description": (
            "Ross Money - DevOps-focused developer building dependable "
            "systems, automation layers, and production-ready interfaces."
        ),
    },
    "hero": {
        "type": "lowImpact",
        "richText": rich_text(
            heading("Building dependable systems", "h1"),
            paragraph(
                "I design and ship resilient developer experiences and "
                "production-ready interfaces."
            ),
        ),
        "links": [{"link": {"type": "custom", "url": "/travelling", "label": "Travelling"}}],
    },
    "data": {
        "metrics": [
            {"value": "99.95%", "label": "availability target"},
            {"value": "24/7", "label": "operations mindset"},
        ]
    },
    "updatedAt": "2026-10-31T00:15:22.968000Z",
    "slug": "home",
}


PROJECT = {
    "_id": "6adbb4485df09cbe407ddb16",
    "title": "Morphsites",
    "role": "Backend developer across Laravel and legacy PHP",
    "summary": (
        "Built and maintained new Laravel projects and older PHP/Statamic "
        "sites, while handling support tickets autonomously through Jira."
    ),
    "tags": [{"tag": "Laravel"}, {"tag": "Statamic"}, {"tag": "Jira support"}],
    "updatedAt": "2026-10-31T00:15:23.825000Z",
}


EXPERIENCE = {
    "_id": "6adbb448cdb0a4642ab1532b",
    "year": "2024 - Present",
    "title": "Personal infrastructure",
    "organization": "Homelab and service automation",
    "summary": (
        "Building portfolio tooling, reverse-proxy deployments, and "
        "containerized services that I can operate end-to-end."
    ),
    "highlights": [
        {"highlight": "Docker"},
        {"highlight": "NGINX"},
        {"highlight": "Go services"},
    ],
    "updatedAt": "2026-10-31T00:15:23.968000Z",
}


class PageChunkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.chunks = chunk_document(PAGE, "page")
        self.sections = [section for section, _ in self.chunks]

    def test_named_sections_are_present(self) -> None:
        for section in ("lead", "focus", "meta", "hero"):
            self.assertIn(section, self.sections)

    def test_rich_text_is_prose_not_json(self) -> None:
        joined = "\n".join(text for _, text in self.chunks)
        self.assertIn("Building dependable systems", joined)
        self.assertNotIn("{", joined)
        self.assertNotIn("}", joined)
        self.assertNotIn("_id", joined)
        self.assertNotIn("root", joined)
        self.assertNotIn("version", joined)

    def test_heading_and_following_paragraph_stay_together(self) -> None:
        hero = [text for section, text in self.chunks if section == "hero"][0]
        self.assertIn("Building dependable systems", hero)
        self.assertIn("I design and ship resilient developer experiences", hero)

    def test_meta_description_is_a_chunk(self) -> None:
        meta = [text for section, text in self.chunks if section == "meta"][0]
        self.assertIn("Ross Money", meta)
        self.assertIn("production-ready interfaces", meta)

    def test_focus_items_are_readable_prose(self) -> None:
        focus = [text for section, text in self.chunks if section == "focus"][0]
        self.assertIn("Role: DevOps-focused developer", focus)
        self.assertIn("Specialty: Storage servers", focus)

    def test_labels_are_short_lower_case_identifiers(self) -> None:
        for section, _ in self.chunks:
            self.assertLessEqual(len(section), MAX_SECTION_CHARS)
            self.assertRegex(section, r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class ProjectChunkTests(unittest.TestCase):
    def test_summary_and_tags(self) -> None:
        chunks = chunk_document(PROJECT, "project")
        sections = [section for section, _ in chunks]
        self.assertIn("summary", sections)
        self.assertIn("tags", sections)

        joined = "\n".join(text for _, text in chunks)
        self.assertIn("Morphsites", joined)
        self.assertIn("Laravel", joined)
        self.assertNotIn("{", joined)


class ExperienceChunkTests(unittest.TestCase):
    def test_summary_and_highlights(self) -> None:
        chunks = chunk_document(EXPERIENCE, "experience")
        sections = [section for section, _ in chunks]
        self.assertIn("summary", sections)
        self.assertIn("highlights", sections)

        joined = "\n".join(text for _, text in chunks)
        self.assertIn("Personal infrastructure", joined)
        self.assertIn("Homelab and service automation", joined)
        self.assertIn("Docker", joined)
        self.assertNotIn("{", joined)


class EdgeCaseTests(unittest.TestCase):
    def test_document_with_no_prose_produces_no_chunks(self) -> None:
        self.assertEqual(
            chunk_document(
                {"_id": "abc", "slug": "empty", "updatedAt": "2026-01-01"}, "page"
            ),
            [],
        )

    def test_unknown_kind_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            chunk_document(PAGE, "post")

    def test_non_dict_is_rejected(self) -> None:
        with self.assertRaises(TypeError):
            chunk_document([], "page")  # type: ignore[arg-type]

    def test_long_text_is_split_under_the_cap(self) -> None:
        sentence = (
            "This is a deliberately long section used to check sentence "
            "boundary splitting across a wide run of prose. "
        )
        doc = {
            "_id": "long",
            "title": "Long document",
            "lead": sentence * 40,
            "updatedAt": "2026-01-01",
        }
        chunks = chunk_document(doc, "page")
        self.assertGreater(len(chunks), 1)
        for _, text in chunks:
            self.assertLessEqual(len(text), MAX_CHUNK_CHARS)

    def test_chunk_count_is_capped_and_keeps_substantive_sections(self) -> None:
        data = {
            f"section{index}": (
                f"Section {index} prose. " + ("Substantive content here " * 12)
            )
            for index in range(1, 21)
        }
        doc = {
            "_id": "many",
            "title": "Many sections",
            "lead": "A lead paragraph for the many-sections document.",
            "data": data,
            "updatedAt": "2026-01-01",
        }
        chunks = chunk_document(doc, "page")
        self.assertLessEqual(len(chunks), MAX_CHUNKS)
        # The lead is protected and must survive the cap.
        self.assertIn("lead", [section for section, _ in chunks])

    def test_tiny_fragments_are_coalesced(self) -> None:
        doc = {
            "_id": "tiny",
            "title": "Tiny",
            "data": {
                "one": "A very short line.",
                "two": "Another short line.",
                "three": "A third short line.",
            },
            "updatedAt": "2026-01-01",
        }
        chunks = chunk_document(doc, "page")
        self.assertLess(len(chunks), 3)
        self.assertTrue(any(len(text) > 40 for _, text in chunks))

    def test_every_chunk_is_non_empty_and_has_no_serialised_json(self) -> None:
        for kind, doc in (
            ("page", PAGE),
            ("project", PROJECT),
            ("experience", EXPERIENCE),
        ):
            for section, text in chunk_document(doc, kind):
                self.assertTrue(text.strip())
                self.assertIsNone(re.search(r'"[a-zA-Z_]+"\s*:', text))
                self.assertNotIn("updatedAt", text)
                self.assertNotIn("createdAt", text)


if __name__ == "__main__":
    unittest.main()
