#!/usr/bin/env python3
"""stdio MCP server exposing semantic search over the CMS content in Oracle."""

from __future__ import annotations

from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from oracle_search import DEFAULT_LIMIT, MAX_LIMIT, SearchError, search_content

mcp = MCPServer(
    name="oracle-search",
    title="Oracle content search",
    version="0.1.0",
    instructions=(
        "Semantic search over the ross.money CMS content (pages, projects and "
        "experience) stored in Oracle. Use search_content to find the most "
        "relevant chunks for a natural-language query."
    ),
)


@mcp.tool(
    name="search_content",
    description=(
        "Semantic search over the CMS content in Oracle. Returns the nearest "
        "chunks ranked by cosine distance, each with kind, title, slug, "
        "distance and snippet. limit defaults to "
        f"{DEFAULT_LIMIT} and is capped at {MAX_LIMIT}."
    ),
)
def search_content_tool(query: str, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """Search CMS content by meaning and return the closest chunks."""

    try:
        return search_content(query, limit)
    except SearchError as exc:
        # ToolError reaches the client as isError=true with this text, without a
        # stack trace being logged as a crash.
        raise ToolError(str(exc)) from None


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
