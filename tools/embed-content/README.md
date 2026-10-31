# embed-content

Chunk every ross.money CMS document into readable prose sections and embed the
sections into Oracle. This replaces the old whole-document embeddings that made
page prose dominate semantic search.

The script reads the Payload/MongoDB-compatible storage tables
`ROSSMONEY."pages"`, `ROSSMONEY."projects"` and `ROSSMONEY."experiences"` and
writes to `ROSSMONEY.content_embeddings`. Embeddings are produced in the
database with `ADMIN.embed_text`, so no embedding API key or local model is
needed.

## Why chunks

The first embedder stored one serialised JSON document per vector. A question
such as "professional experience" then matched a whole page, because the page's
prose was one large competing vector, rather than matching the small
`experience` records. Chunking gives each logical section its own vector and
keeps short records at their natural size.

## Requirements

- Python 3.10 or newer.
- Network access to the Oracle database and its wallet.
- An account that can read the three source tables, write
  `ROSSMONEY.content_embeddings`, execute `ADMIN.embed_text`, and add the
  `section` column if it is missing.

## Install

From this directory:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Environment

The script never reads credentials from a file in the repository.

| Variable | Required | Meaning |
| --- | --- | --- |
| `ORACLE_TNS_ADMIN` | yes | Directory holding the wallet and `tnsnames.ora`, for example `/path/to/Wallet_rossadb` |
| `ORACLE_USER` | yes | Database user with access to the source tables, `ROSSMONEY.content_embeddings` and `ADMIN.embed_text` |
| `ORACLE_PASSWORD` | yes | Password for that user |
| `ORACLE_DSN` | yes | TNS alias from `tnsnames.ora`, for example `rossadb_high` |
| `ORACLE_WALLET_PASSWORD` | no | Only if the wallet's `ewallet.pem` is password-protected |

`ORACLE_TNS_ADMIN` is passed to `oracledb.connect` as both `config_dir` and
`wallet_location`, which is what thin mode needs to resolve the alias and open
the wallet.

## Run

Print what would be written without changing anything:

```bash
cd tools/embed-content
.venv/bin/python main.py --dry-run
```

Embed and store the changes:

```bash
cd tools/embed-content
.venv/bin/python main.py
```

The script is incremental. For each document it chunks the current JSON, then
checks the stored rows. It skips the document when **both** conditions hold:

1. every stored row for that document has `source_updated` equal to the
   document's `updatedAt`; and
2. the number of stored rows equals the number of chunks the current document
   produces.

Otherwise it deletes that document's existing rows (including legacy row ids
without a `#n` suffix) and inserts one row per chunk with:

| Column | Value |
| --- | --- |
| `id` | `<kind>:<docId>#<n>` |
| `kind` | `page`, `project` or `experience` |
| `slug` | the page slug (empty for projects and experience) |
| `title` | the document title |
| `chunk` | the section prose |
| `embedding` | `ADMIN.embed_text(chunk)` |
| `section` | the short section label (`lead`, `focus`, `hero`, ...) |
| `source_updated` | the document's `updatedAt` |

The `section VARCHAR2(64)` column is added automatically when it is missing.
A dry run prints that it would add the column but does not run the `ALTER`.

The final summary reports:

- documents scanned;
- documents skipped as unchanged;
- documents written (or that would be written);
- chunks written (or that would be written).

## Chunking rules

The pure implementation is in `chunker.py`.

1. **Prose only.** The walker visits strings in the document and ignores ids,
   timestamps, editor metadata, URLs, hrefs and numeric config. It never embeds
   serialised JSON.
2. **Logical sections.** A page produces a `lead` chunk from title/eyebrow/lead,
   a `focus` chunk from the focus items, a `meta` chunk from the SEO fields,
   `hero` chunks from the hero Lexical rich text, and one section per layout
   block or top-level `data` key. A project produces `summary` and `tags`; an
   experience produces `summary` and `highlights`.
3. **Rich text keeps its heading.** Lexical blocks are grouped under the most
   recent heading, so a heading stays with the paragraphs it introduces.
4. **Tiny fragments are coalesced.** Fragments under about 200 characters are
   merged into a neighbour, up to the 1,000-character ceiling. Named prose
   sections (`lead`, `summary`, `meta`, `focus`, `hero`, `tags`, `highlights`)
   stay separate even when short.
5. **Long runs are split.** Text above 1,000 characters is cut on paragraph
   boundaries, then sentence boundaries, then word boundaries.
6. **At most 12 chunks per document.** When a document produces more, the named
   prose sections are kept and the remaining slots go to the longest chunks;
   the original document order is restored.
7. **Section labels** are short lower-case identifiers derived from JSON keys,
   capped at 64 characters to match the database column.

## Important: disable the daily database job

Once this script is in use, disable the database job `REFRESH_EMBEDDINGS_JOB`.
That job writes whole-document chunks. If it keeps running it will re-create the
old one-vector-per-document rows alongside the section chunks, and search
results will regress.

You can inspect scheduled jobs with:

```sql
SELECT job_name, enabled, repeat_interval
FROM user_scheduler_jobs
WHERE job_name = 'REFRESH_EMBEDDINGS_JOB';
```

and disable it with `DBMS_SCHEDULER.DISABLE('REFRESH_EMBEDDINGS_JOB')`.

The live re-embed and the job change are operational steps owned by the first
mate; they are not performed by this script.

## Test

The tests use no database, wallet or embedding model:

```bash
cd tools/embed-content
python3 -m unittest discover -s tests -v
python3 -m compileall -q .
```

They cover a page with Lexical rich text, a project, an experience, a document
with no prose, the size cap, section labels, coalescing, splitting and
skip-on-unchanged logic.

## Layout

| File | Purpose |
| --- | --- |
| `chunker.py` | Pure chunking: walk, group, coalesce, split, cap |
| `main.py` | Oracle connection, source reads, skip logic, delete/insert, CLI |
| `tests/test_chunker.py` | Chunking and size/label edge cases |
| `tests/test_main.py` | Row-id parsing, existing-row index, skip logic, plan output |
| `requirements.txt` | Pinned `oracledb` |
