"""Turn CMS JSON documents into readable embedding chunks.

The functions in this module are pure: no Oracle, no network, no file I/O. The
ingest script in :mod:`main` calls :func:`chunk_document` and handles storage.

Why this exists
===============
The first version of the embedder stored one serialised JSON document per
vector. A page's prose then competed with every other page as a single giant
chunk, so a query such as "professional experience" matched page prose instead
of the small experience records. This module walks a document, keeps only its
text values, and returns a handful of labelled prose sections instead.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

#: No chunk is longer than this, so an embedding stays a focused piece of text.
MAX_CHUNK_CHARS = 1000
#: Fragments below this length are candidates for coalescing with a neighbour.
MIN_FRAGMENT_CHARS = 200
#: Hard ceiling on chunks per document. The most substantive chunks win.
MAX_CHUNKS = 12
#: ``section`` is stored as ``VARCHAR2(64)`` in Oracle.
MAX_SECTION_CHARS = 64

#: Sections that must stay distinct even when short. These are the labels the
#: chunking contract names explicitly (lead, summary, focus, meta, hero) plus
#: the two top-level record sections for projects and experience.
PROTECTED_SECTIONS = frozenset(
    {"lead", "summary", "meta", "focus", "hero", "tags", "highlights"}
)

#: Keys that hold identity, editor metadata, or link targets rather than prose.
#: ``tag`` is deliberately absent: project tags use ``{"tag": "Laravel"}`` and
#: that value is useful prose.
IGNORED_KEYS = frozenset(
    {
        "_id",
        "id",
        "slug",
        "createdat",
        "updatedat",
        "__v",
        "_status",
        "order",
        "generateslug",
        "blockname",
        "blocktype",
        "type",
        "format",
        "detail",
        "mode",
        "style",
        "version",
        "direction",
        "indent",
        "textformat",
        "linktype",
        "newtab",
        "appearance",
        "url",
        "href",
        "currency",
        "unit",
        "arialabel",
        "embedding",
        "publishedat",
    }
)

#: Keys that end in one of these suffixes are links or repository identifiers.
IGNORED_KEY_SUFFIXES = ("url", "href")

#: Container keys that do not start a new logical section. Their contents keep
#: the parent's label (a layout block stays "content", a service's bullet list
#: stays part of that service).
STRUCTURAL_KEYS = frozenset(
    {
        "blocks",
        "body",
        "children",
        "column",
        "columns",
        "content",
        "includes",
        "items",
        "richtext",
        "rows",
    }
)

_WHITESPACE = re.compile(r"\s+")
_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])([A-Z])")
_NON_SECTION = re.compile(r"[^a-z0-9]+")
_URL = re.compile(r"^(?:https?://|mailto:|tel:|/|#)", re.IGNORECASE)
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")


def _clean(text: str) -> str:
    return _WHITESPACE.sub(" ", text).strip()


def _is_meaningful(text: str) -> bool:
    """True when ``text`` contains prose rather than an id, URL or punctuation."""

    if len(text) < 2 or _URL.match(text):
        return False
    return any(character.isalpha() for character in text)


def _is_ignored_key(key: str) -> bool:
    lowered = key.lower()
    return lowered in IGNORED_KEYS or lowered.endswith(IGNORED_KEY_SUFFIXES)


def _section_label(key: str) -> str:
    """Turn a JSON key into a short, stable section label."""

    spaced = _CAMEL_BOUNDARY.sub(r"-\1", key)
    label = _NON_SECTION.sub("-", spaced.lower()).strip("-")
    return (label or "content")[:MAX_SECTION_CHARS]


def _join(parts: Iterable[str]) -> str:
    """Join prose fragments into sentences, adding stops where they are missing."""

    cleaned: list[str] = []
    for part in parts:
        text = _clean(part)
        if not text:
            continue
        if text[-1] not in ".!?;:":
            text += "."
        cleaned.append(text)
    return " ".join(cleaned)


def _is_lexical(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and ("root" in value or value.get("type") == "root")
        and isinstance(value.get("root", value), dict)
    )


def _inline_text(node: Any) -> str:
    """Concatenate the text leaves of a Lexical inline node."""

    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(_inline_text(child) for child in node)
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text" and isinstance(node.get("text"), str):
        return node["text"]
    if node.get("type") == "linebreak":
        return " "
    return "".join(_inline_text(child) for child in node.get("children", []))


def _node_text(node: Any) -> str:
    if not isinstance(node, dict):
        return _clean(_inline_text(node))
    if node.get("type") == "list":
        items = [
            _clean(_inline_text(child))
            for child in node.get("children", [])
            if isinstance(child, dict)
        ]
        return _join(item for item in items if item)
    return _clean(_inline_text(node))


def _lexical_groups(value: Any) -> list[str]:
    """Split Lexical rich text into heading-led paragraph groups.

    Each heading starts a new group; paragraphs, lists and quotes that follow it
    stay together. That keeps a heading beside the prose it introduces instead
    of flattening the whole document into one run.
    """

    if not isinstance(value, dict):
        return []
    root = value.get("root", value)
    if not isinstance(root, dict):
        return []
    children = root.get("children")
    if not isinstance(children, list):
        text = _node_text(root)
        return [text] if _is_meaningful(text) else []

    groups: list[str] = []
    heading = ""
    body: list[str] = []

    def flush() -> None:
        text = _join(([heading] if heading else []) + body)
        if _is_meaningful(text):
            groups.append(text)

    for child in children:
        if not isinstance(child, dict):
            continue
        if child.get("type") == "heading":
            flush()
            heading = _node_text(child)
            body = []
        else:
            text = _node_text(child)
            if _is_meaningful(text):
                body.append(text)
    flush()
    return groups


def _is_label_value(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and "label" in value
        and "value" in value
        and set(value).issubset({"label", "value", "id", "_id"})
    )


def _flatten_into(value: Any, parts: list[str]) -> None:
    """Collect readable text from an arbitrary JSON value, in document order."""

    if isinstance(value, str):
        text = _clean(value)
        if _is_meaningful(text):
            parts.append(text)
        return
    if isinstance(value, list):
        for item in value:
            _flatten_into(item, parts)
        return
    if not isinstance(value, dict):
        return
    if _is_lexical(value):
        parts.extend(_lexical_groups(value))
        return
    if _is_label_value(value):
        label = _clean(str(value.get("label", "")))
        prose = _clean(str(value.get("value", "")))
        if label and prose:
            parts.append(f"{label}: {prose}")
        elif prose:
            parts.append(prose)
        return
    for key, item in value.items():
        if _is_ignored_key(key):
            continue
        _flatten_into(item, parts)


def _flatten(value: Any) -> str:
    parts: list[str] = []
    _flatten_into(value, parts)
    return _join(parts)


def _extract(value: Any, label: str, out: list[tuple[str, str]]) -> None:
    """Append one or more ``(section, text)`` fragments for ``value``."""

    if isinstance(value, str):
        text = _clean(value)
        if _is_meaningful(text):
            out.append((label, text))
        return

    if isinstance(value, list):
        if not value:
            return
        if all(not isinstance(item, (dict, list)) for item in value):
            text = _join(
                _clean(item) for item in value if isinstance(item, str)
            )
            if _is_meaningful(text):
                out.append((label, text))
            return
        for item in value:
            _extract(item, label, out)
        return

    if not isinstance(value, dict):
        return

    if _is_lexical(value):
        for group in _lexical_groups(value):
            out.append((label, group))
        return

    if _is_label_value(value):
        text = _flatten(value)
        if text:
            out.append((label, text))
        return

    scalars: list[str] = []
    children: list[tuple[str, Any]] = []
    for key, item in value.items():
        if _is_ignored_key(key):
            continue
        if isinstance(item, (dict, list)):
            children.append((key, item))
        elif isinstance(item, str):
            text = _clean(item)
            if _is_meaningful(text):
                scalars.append(text)

    if scalars:
        out.append((label, _join(scalars)))

    for key, item in children:
        # Structural containers belong to their parent section (focus items,
        # layout columns, a service's includes list, and so on).
        child_label = (
            label if key.lower() in STRUCTURAL_KEYS else _section_label(key)
        )
        _extract(item, child_label, out)


def _merge_same_section(
    fragments: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    merged: list[tuple[str, str]] = []
    for label, text in fragments:
        if (
            merged
            and merged[-1][0] == label
            and len(merged[-1][1]) + 1 + len(text) <= MAX_CHUNK_CHARS
        ):
            merged[-1] = (label, f"{merged[-1][1]} {text}")
        else:
            merged.append((label, text))
    return merged


def _coalesce_tiny(fragments: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Merge fragments below :data:`MIN_FRAGMENT_CHARS` into a neighbour.

    Named prose sections stay separate even when short, because the contract
    promises a chunk for the lead, summary, focus, meta description and hero
    rich text. Everything else (button labels, tags, "includes" lists) is too
    small to carry a useful vector on its own.
    """

    result = list(fragments)
    index = 0
    while index < len(result):
        label, text = result[index]
        if label in PROTECTED_SECTIONS or len(text) >= MIN_FRAGMENT_CHARS:
            index += 1
            continue
        if index > 0:
            previous_label, previous_text = result[index - 1]
            if len(previous_text) + 1 + len(text) <= MAX_CHUNK_CHARS:
                result[index - 1] = (previous_label, f"{previous_text} {text}")
                del result[index]
                continue
        if index + 1 < len(result):
            next_label, next_text = result[index + 1]
            if len(text) + 1 + len(next_text) <= MAX_CHUNK_CHARS:
                result[index + 1] = (next_label, f"{text} {next_text}")
                del result[index]
                continue
        index += 1
    return result


def _split_sentence(sentence: str) -> list[str]:
    if len(sentence) <= MAX_CHUNK_CHARS:
        return [sentence]
    pieces: list[str] = []
    current = ""
    for word in sentence.split():
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= MAX_CHUNK_CHARS:
            current += f" {word}"
        else:
            pieces.append(current)
            current = word
    if current:
        pieces.append(current)
    return pieces


def _split_text(text: str) -> list[str]:
    """Split prose on paragraph, then sentence, then word boundaries."""

    if len(text) <= MAX_CHUNK_CHARS:
        return [text]

    paragraphs = [part.strip() for part in text.splitlines() if part.strip()]
    if len(paragraphs) > 1:
        pieces: list[str] = []
        current = ""
        for paragraph in paragraphs:
            if len(paragraph) > MAX_CHUNK_CHARS:
                if current:
                    pieces.append(current)
                    current = ""
                pieces.extend(_split_text(paragraph))
            elif not current:
                current = paragraph
            elif len(current) + 1 + len(paragraph) <= MAX_CHUNK_CHARS:
                current += f" {paragraph}"
            else:
                pieces.append(current)
                current = paragraph
        if current:
            pieces.append(current)
        return pieces

    sentences = _SENTENCE_BOUNDARY.split(text)
    pieces = []
    current = ""
    for sentence in sentences:
        for part in _split_sentence(sentence.strip()):
            if not part:
                continue
            if not current:
                current = part
            elif len(current) + 1 + len(part) <= MAX_CHUNK_CHARS:
                current += f" {part}"
            else:
                pieces.append(current)
                current = part
    if current:
        pieces.append(current)
    return pieces


def _split_long(
    fragments: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for label, text in fragments:
        for piece in _split_text(text):
            result.append((label, piece))
    return result


def _cap(fragments: list[tuple[str, str]]) -> list[tuple[str, str]]:
    if len(fragments) <= MAX_CHUNKS:
        return fragments

    positions = list(range(len(fragments)))
    protected = [
        position
        for position in positions
        if fragments[position][0] in PROTECTED_SECTIONS
    ]
    if len(protected) >= MAX_CHUNKS:
        kept = sorted(
            protected,
            key=lambda position: len(fragments[position][1]),
            reverse=True,
        )[:MAX_CHUNKS]
    else:
        remaining = [position for position in positions if position not in protected]
        remaining.sort(
            key=lambda position: len(fragments[position][1]),
            reverse=True,
        )
        kept = protected + remaining[: MAX_CHUNKS - len(protected)]
    return [fragments[position] for position in sorted(kept)]


def _postprocess(fragments: list[tuple[str, str]]) -> list[tuple[str, str]]:
    cleaned = [
        (label, _clean(text))
        for label, text in fragments
        if _is_meaningful(_clean(text))
    ]
    cleaned = _merge_same_section(cleaned)
    cleaned = _coalesce_tiny(cleaned)
    cleaned = _split_long(cleaned)
    cleaned = _merge_same_section(cleaned)
    return _cap(cleaned)


def _page_fragments(doc: dict[str, Any]) -> list[tuple[str, str]]:
    fragments: list[tuple[str, str]] = []

    identity = [
        doc[key]
        for key in ("title", "eyebrow", "lead")
        if isinstance(doc.get(key), str) and _is_meaningful(_clean(doc[key]))
    ]
    if identity:
        fragments.append(("lead", _join(identity)))

    if doc.get("focus"):
        _extract(doc["focus"], "focus", fragments)

    if doc.get("meta"):
        _extract(doc["meta"], "meta", fragments)

    hero = doc.get("hero")
    if isinstance(hero, dict):
        rich_text = hero.get("richText")
        if rich_text:
            _extract(rich_text, "hero", fragments)
        else:
            _extract(hero, "hero", fragments)
    elif hero:
        _extract(hero, "hero", fragments)

    layout = doc.get("layout")
    if isinstance(layout, list):
        for block in layout:
            if not isinstance(block, dict):
                continue
            label = _section_label(
                block.get("blockType")
                or block.get("blockName")
                or "content"
            )
            _extract(block, label, fragments)

    data = doc.get("data")
    if isinstance(data, dict):
        for key, value in data.items():
            if _is_ignored_key(key):
                continue
            _extract(value, _section_label(key), fragments)
    elif data:
        _extract(data, "data", fragments)

    handled = {
        "title",
        "eyebrow",
        "lead",
        "focus",
        "meta",
        "hero",
        "layout",
        "data",
    }
    for key, value in doc.items():
        if key in handled or _is_ignored_key(key):
            continue
        _extract(value, _section_label(key), fragments)

    return fragments


def _project_fragments(doc: dict[str, Any]) -> list[tuple[str, str]]:
    fragments: list[tuple[str, str]] = []
    identity = [
        doc[key]
        for key in ("title", "role", "summary")
        if isinstance(doc.get(key), str) and _is_meaningful(_clean(doc[key]))
    ]
    if identity:
        fragments.append(("summary", _join(identity)))

    if doc.get("tags"):
        _extract(doc["tags"], "tags", fragments)

    handled = {"title", "role", "summary", "tags"}
    for key, value in doc.items():
        if key in handled or _is_ignored_key(key):
            continue
        _extract(value, _section_label(key), fragments)
    return fragments


def _experience_fragments(doc: dict[str, Any]) -> list[tuple[str, str]]:
    fragments: list[tuple[str, str]] = []
    identity = [
        doc[key]
        for key in ("title", "year", "organization", "summary")
        if isinstance(doc.get(key), str) and _is_meaningful(_clean(doc[key]))
    ]
    if identity:
        fragments.append(("summary", _join(identity)))

    if doc.get("highlights"):
        _extract(doc["highlights"], "highlights", fragments)

    handled = {"title", "year", "organization", "summary", "highlights"}
    for key, value in doc.items():
        if key in handled or _is_ignored_key(key):
            continue
        _extract(value, _section_label(key), fragments)
    return fragments


def chunk_document(
    doc: dict[str, Any], kind: str
) -> list[tuple[str, str]]:
    """Return ``(section, text)`` chunks for one CMS document.

    ``kind`` is ``page``, ``project`` or ``experience`` — the same values stored
    in ``ROSSMONEY.content_embeddings.kind``. The result never contains
    serialised JSON, ids, timestamps or URLs, and is already coalesced, split
    and capped.
    """

    if not isinstance(doc, dict):
        raise TypeError("doc must be a dict")

    if kind == "page":
        fragments = _page_fragments(doc)
    elif kind == "project":
        fragments = _project_fragments(doc)
    elif kind == "experience":
        fragments = _experience_fragments(doc)
    else:
        raise ValueError(
            f"unsupported kind {kind!r}; expected page, project or experience"
        )

    return _postprocess(fragments)
