#!/usr/bin/env node
/**
 * Unpublish the two retired page documents without deleting their data.
 *
 * The `commits`, `experience-page`, `work` and `architecture` pages are kept in
 * the CMS because the homepage still reads their content. They must not be
 * public, so this one-off helper updates their `_status` to `draft`. It never
 * deletes anything.
 *
 * Usage (from the repository root):
 *   pnpm --filter payload-cms run unpublish:retired-pages
 *   pnpm --filter payload-cms run unpublish:retired-pages -- --apply
 *
 * The default is a dry run. `--apply` performs the status update. Set the same
 * database environment variables the CMS uses (`MONGODB_URI`/`DATABASE_URL`,
 * `PAYLOAD_SECRET`, and optionally `NEXT_PUBLIC_SERVER_URL`) before running it.
 * Do not run this against a deployed database without a backup.
 */
import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../src/payload.config'

const RETIRED_PAGE_SLUGS = ['commits', 'experience-page', 'work', 'architecture'] as const

function printUsage() {
  console.log(`Usage: pnpm --filter payload-cms run unpublish:retired-pages [-- --dry-run|--apply]

  --dry-run  Report what would change (default).
  --apply    Set the matching page documents to draft.
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

  for (const arg of args) {
    if (arg !== '--apply' && arg !== '--dry-run' && arg !== '--help' && arg !== '-h') {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (apply && dryRun) {
    throw new Error('Choose either --dry-run or --apply, not both')
  }

  return { apply }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) return

  const payload = await getPayload({ config })

  try {
    const pages = await payload.find({
      collection: 'pages',
      where: {
        slug: {
          in: [...RETIRED_PAGE_SLUGS],
        },
      },
      draft: true,
      depth: 0,
      limit: 100,
      pagination: false,
    })

    if (pages.docs.length === 0) {
      console.log('No matching page documents found. Nothing to do.')
      return
    }

    for (const page of pages.docs) {
      console.log(`- ${page.slug} (id ${page.id}, status ${page._status ?? 'unknown'})`)
    }

    if (!options.apply) {
      console.log('\nDry run: no documents changed. Re-run with --apply to unpublish them.')
      return
    }

    for (const page of pages.docs) {
      if (page._status === 'draft') {
        console.log(`Skipping ${page.slug}: already a draft.`)
        continue
      }

      await payload.update({
        collection: 'pages',
        id: page.id,
        data: {
          _status: 'draft',
        },
        context: {
          disableRevalidate: true,
        },
      })
      console.log(`Unpublished ${page.slug}.`)
    }
  } finally {
    await payload.destroy()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
