#!/usr/bin/env node
/**
 * Delete duplicate `projects` and `experience` documents, keeping the row the
 * site would render.
 *
 * Several deployments can seed the same database. Startup seeding used to
 * compare titles exactly against a list fetched before its own inserts, which
 * let two deployments create their own copy of every default project. The site
 * now de-duplicates at read time, but the extra rows remain in the database
 * until this helper removes them.
 *
 * Matching, ordering and tie-breaking are delegated to
 * `src/utilities/dedupeByTitle.ts`, so this script deletes exactly the rows the
 * read path ignores: lowest numeric `order` wins, oldest `createdAt` breaks a
 * tie. Only `projects` and `experience` are touched.
 *
 * Usage (from the repository root):
 *   pnpm --filter payload-cms run dedupe:collections
 *   pnpm --filter payload-cms run dedupe:collections -- --apply
 *
 * The default is a dry run: every row that would be deleted is printed first.
 * `--apply` then performs those exact deletes. Set the same database
 * environment variables the CMS uses (`MONGODB_URI`/`DATABASE_URL`,
 * `PAYLOAD_SECRET`, and optionally `NEXT_PUBLIC_SERVER_URL`) before running it.
 * Take a backup before running it against a deployed database.
 */
import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../src/payload.config'
import { normalizeTitle, partitionDuplicatesByTitle } from '../src/utilities/dedupeByTitle'

const COLLECTIONS = [
  { slug: 'projects', label: 'Projects' },
  { slug: 'experience', label: 'Experience' },
] as const

interface CollectionDoc {
  id: number | string
  title?: string | null
  order?: number | null
  createdAt?: string | Date | null
}

function printUsage() {
  console.log(`Usage: pnpm --filter payload-cms run dedupe:collections [-- --dry-run|--apply]

  --dry-run  Report what would be deleted (default).
  --apply    Delete the reported duplicate rows.
`)
}

function parseArgs(argv: string[]): { apply: boolean } | null {
  const args = new Set(argv)
  const apply = args.has('--apply')
  const dryRun = args.has('--dry-run')

  if (args.has('--help') || args.has('-h')) {
    printUsage()
    return null
  }

  for (const arg of argv) {
    if (arg !== '--apply' && arg !== '--dry-run' && arg !== '--help' && arg !== '-h') {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (apply && dryRun) {
    throw new Error('Choose either --dry-run or --apply, not both')
  }

  return { apply }
}

function describe(doc: CollectionDoc): string {
  const order = typeof doc.order === 'number' ? String(doc.order) : 'no order'
  const createdAt = doc.createdAt ? new Date(doc.createdAt).toISOString() : 'no createdAt'
  return `id ${doc.id}, order ${order}, createdAt ${createdAt}`
}

async function dedupeCollection(
  slug: 'projects' | 'experience',
  label: string,
  docs: CollectionDoc[],
  apply: boolean,
  deleteDoc: (id: number | string) => Promise<unknown>,
): Promise<number> {
  const { kept, duplicates } = partitionDuplicatesByTitle(docs)

  console.log(`\n${label}: ${docs.length} document(s), ${kept.length} to keep, ${duplicates.length} duplicate(s)`)

  if (duplicates.length === 0) {
    console.log('  Nothing to delete.')
    return 0
  }

  const keptByKey = new Map(kept.map((doc) => [normalizeTitle(doc.title), doc]))

  for (const duplicate of duplicates) {
    const winner = keptByKey.get(normalizeTitle(duplicate.title))

    console.log(`  delete ${JSON.stringify(duplicate.title ?? '')} (${describe(duplicate)})`)
    if (winner) {
      console.log(`    keep   ${JSON.stringify(winner.title ?? '')} (${describe(winner)})`)
    }
  }

  if (!apply) {
    return duplicates.length
  }

  for (const duplicate of duplicates) {
    await deleteDoc(duplicate.id)
    console.log(`  deleted ${slug} id ${duplicate.id}`)
  }

  return duplicates.length
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) return

  const payload = await getPayload({ config })

  try {
    let pending = 0

    for (const collection of COLLECTIONS) {
      const result = await payload.find({
        collection: collection.slug,
        depth: 0,
        limit: 1000,
        pagination: false,
        sort: 'order',
      })

      pending += await dedupeCollection(
        collection.slug,
        collection.label,
        result.docs as CollectionDoc[],
        options.apply,
        (id) =>
          payload.delete({
            collection: collection.slug,
            id,
            context: { disableRevalidate: true },
          }),
      )
    }

    if (pending === 0) {
      console.log('\nNo duplicate rows found. Nothing to do.')
    } else if (options.apply) {
      console.log(`\nDeleted ${pending} duplicate row(s).`)
    } else {
      console.log(`\nDry run: no documents deleted. Re-run with --apply to delete ${pending} duplicate row(s).`)
    }
  } finally {
    await payload.destroy()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
