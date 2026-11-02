#!/usr/bin/env node
/**
 * Backfill the `template` field on page documents created before it existed.
 *
 * Each page gets the template the old hardcoded route chain gave its slug
 * (home → home, contact → contact, game-servers/gameservers → game-servers,
 * and so on). Pages with no slug mapping get `default`, which renders them
 * generically. Documents that already store a template are left untouched, so
 * this is safe to run more than once and never overwrites an editor's choice.
 *
 * Fresh databases do not need this: the seed data already includes `template`,
 * and `payload.config.ts` onInit applies the same fill-in to older databases.
 * Use this helper when you want to run the backfill explicitly against an
 * existing database.
 *
 * Usage (from the repository root):
 *   pnpm --filter payload-cms run backfill:page-templates
 *   pnpm --filter payload-cms run backfill:page-templates -- --apply
 *
 * The default is a dry run. `--apply` performs the update. Set the same
 * database environment variables the CMS uses (`MONGODB_URI`/`DATABASE_URL`,
 * `PAYLOAD_SECRET`, and optionally `NEXT_PUBLIC_SERVER_URL`) before running it.
 * Do not run this against a deployed database without a backup.
 */
import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../src/payload.config'
import { DEFAULT_PAGE_TEMPLATE, templateFromSlug, type PageTemplate } from '../src/utilities/pageTemplates'

function templateFor(slug: string): PageTemplate {
  return templateFromSlug(slug) ?? DEFAULT_PAGE_TEMPLATE
}

function printUsage() {
  console.log(`Usage: pnpm --filter payload-cms run backfill:page-templates [-- --dry-run|--apply]

  --dry-run  Report what would change (default).
  --apply    Write the derived template onto pages that have none.
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

function hasTemplate(template: unknown): boolean {
  // An unrecognised value is intentional data in this field (the runtime
  // renders it generically), so only a missing value counts as needing one.
  return typeof template === 'string' && template.trim() !== ''
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) return

  const payload = await getPayload({ config })

  try {
    const pages = await payload.find({
      collection: 'pages',
      draft: true,
      depth: 0,
      limit: 1000,
      pagination: false,
    })

    const pending = pages.docs.filter((page) => !hasTemplate(page.template))

    if (pending.length === 0) {
      console.log('Every page already has a template. Nothing to do.')
      return
    }

    for (const page of pending) {
      const template = templateFor(page.slug)
      console.log(
        `- ${page.slug} (id ${page.id}, status ${page._status ?? 'unknown'}) → ${template}`,
      )
    }

    if (!options.apply) {
      console.log('\nDry run: no documents changed. Re-run with --apply to backfill them.')
      return
    }

    for (const page of pending) {
      const template = templateFor(page.slug)
      await payload.update({
        collection: 'pages',
        id: page.id,
        data: { template },
        context: { disableRevalidate: true },
      })
      console.log(`Backfilled ${page.slug} → ${template}.`)
    }
  } finally {
    await payload.destroy()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
