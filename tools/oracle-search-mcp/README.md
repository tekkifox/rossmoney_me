# oracle-search-mcp

A small, standalone [Model Context Protocol](https://modelcontextprotocol.io)
server (stdio transport) that exposes semantic search over the ross.money CMS
content stored in Oracle.

It reads `ROSSMONEY.content_embeddings` (pages, projects and experience) and
ranks rows by cosine distance. The query is embedded **in the database** with
`ADMIN.embed_text`, so the server needs no embedding API key and no model of its
own.

- One MCP tool: `search_content(query, limit=5)`.
- Each result: `{ kind, title, slug, distance, snippet }`, nearest first.
- `limit` defaults to 5 and is always clamped to **1–20**.
- Thin mode `oracledb`: no Oracle Instant Client installation required.
- Any connection or query failure is returned as an MCP tool error with a short
  message and no stack trace.

This directory is not part of the Next/Payload app or the pnpm workspace; it is a
separate Python process that an MCP client starts on demand.

## Requirements

- Python 3.10 or newer (the pinned `mcp` and `oracledb` releases require it).
- Network access to the Oracle database and the wallet directory for that
  database.

## Install

From this directory:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Environment

The server never reads credentials from a file in the repository. Set these
variables in the MCP client configuration (or your shell, for a manual run):

| Variable | Required | Meaning |
| --- | --- | --- |
| `ORACLE_TNS_ADMIN` | yes | Directory holding the wallet and `tnsnames.ora`, e.g. `/path/to/Wallet_rossadb` |
| `ORACLE_USER` | yes | Database user with access to `ROSSMONEY.content_embeddings` and `ADMIN.embed_text` |
| `ORACLE_PASSWORD` | yes | Password for that user |
| `ORACLE_DSN` | yes | TNS alias from `tnsnames.ora`, e.g. `rossadb_high` |
| `ORACLE_WALLET_PASSWORD` | no | Only if the wallet's `ewallet.pem` is password-protected |

`ORACLE_TNS_ADMIN` is passed to `oracledb.connect` as both `config_dir` and
`wallet_location`, which is what thin mode needs to resolve the alias and open
the wallet.

## Run

```bash
cd tools/oracle-search-mcp
.venv/bin/python server.py
```

That is the exact command; it speaks MCP over stdin/stdout and logs to stderr.
Nothing is printed to stdout except protocol messages.

## MCP client configuration

Example JSON block (use absolute paths; keep the real password out of the
repository — most clients support an `env` block, and some support secret
references):

```json
{
  "mcpServers": {
    "oracle-search": {
      "command": "/absolute/path/to/rossmoney_me/tools/oracle-search-mcp/.venv/bin/python",
      "args": [
        "/absolute/path/to/rossmoney_me/tools/oracle-search-mcp/server.py"
      ],
      "env": {
        "ORACLE_TNS_ADMIN": "/absolute/path/to/Wallet_rossadb",
        "ORACLE_USER": "ROSSMONEY",
        "ORACLE_PASSWORD": "your-password",
        "ORACLE_DSN": "rossadb_high"
      }
    }
  }
}
```

For a project-scoped OpenCode configuration the same block goes under the `mcp`
key with `"type": "local"`; other clients use their own schema but the
`command`, `args` and `env` values are the same.

## Tool contract

`search_content`

```json
{
  "query": "docker homelab",
  "limit": 5
}
```

Rows come back nearest first. Each row looks like this:

```json
{
  "kind": "experience",
  "title": "Personal infrastructure",
  "slug": "",
  "distance": 0.482,
  "snippet": "{\"_id\":\"6adbb448cdb0a4642ab1532b\", ..."
}
```

The MCP call returns the rows as structured content under
`structuredContent.result` (an array), and each row is also emitted as its own
JSON object in `content`. Rows are ordered by `distance`, ascending.

- `distance` is the rounded cosine distance (lower is closer); it is `null` only
  if Oracle returns null.
- `snippet` is the first 240 characters of the stored chunk, with an ellipsis
  when truncated.
- An unreachable database, bad wallet, missing environment variable or blank
  query produces `isError: true` with a message such as
  `Could not connect to Oracle DSN 'rossadb_high': ...`. No traceback is sent to
  the client.

## SQL

Both values are bind variables; nothing from the request is concatenated into
the statement:

```sql
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
```

`ROWNUM` is applied in an outer query so the inner `ORDER BY dist` decides which
rows survive the limit, and it accepts a bind variable (unlike some row-limiting
syntax variants).

## Test

The unit tests fake the Oracle connection; no database or wallet is needed:

```bash
cd tools/oracle-search-mcp
.venv/bin/python -m unittest discover -s tests -v
```

They assert that the query and limit are bound as parameters (including a SQL
injection payload), that the limit is clamped, that the result shape and snippet
truncation match this README, and that connection failures become a short
`SearchError`/`ToolError` message rather than a traceback.

## Layout

| File | Purpose |
| --- | --- |
| `server.py` | MCP server, `search_content` tool, stdio entry point |
| `oracle_search.py` | Connection settings, SQL, clamping, result shaping |
| `tests/test_oracle_search.py` | Unit tests with a fake connection |
| `requirements.txt` | Pinned `mcp` and `oracledb` |
