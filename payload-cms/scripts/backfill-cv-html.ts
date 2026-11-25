#!/usr/bin/env node
/**
 * Render the HTML preview for CV media uploaded before this feature existed.
 *
 * New uploads are converted automatically by the media collection's
 * `beforeChange` hook. This helper fills in media documents whose `cvHtml` is
 * still empty: it reads the original DOCX/PDF from local disk (or fetches it
 * through the media URL) and stores the same HTML the upload hook would.
 *
 * Usage (from the repository root):
 *   pnpm --filter payload-cms run backfill:cv-html
 *   pnpm --filter payload-cms run backfill:cv-html -- --apply
 *
 * The default is a dry run. `--apply` performs the update.
 */
import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import { getPayload } from 'payload'

import config from '../src/payload.config'
import { isCvFilename } from '../src/utilities/cvFile'
import { convertCvFile } from '../src/utilities/cvRender'
import { getServerSideURL } from '../src/utilities/getURL'

function printUsage() {
  console.log(`Usage: pnpm --filter payload-cms run backfill:cv-html [-- --dry-run|--apply]

  --dry-run  Report what would change (default).
  --apply    Render and store cvHtml on CV media that has none.
`)
}

function parseArgs(argv: string[]): { apply: boolean } | null {
  const args = new Set(argv)
  if (args.has('--help') || args.has('-h')) {
    printUsage()
    return null
  }

  for (const arg of args) {
    if (arg !== '--apply' && arg !== '--dry-run' && arg !== '--help' && arg !== '-h') {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (args.has('--apply') && args.has('--dry-run')) {
    throw new Error('Choose either --dry-run or --apply, not both')
  }

  return { apply: args.has('--apply') }
}

async function readMediaFile(filename: string, url: string | null | undefined): Promise<Buffer> {
  const localPath = path.resolve(process.cwd(), 'public', 'media', filename)
  try {
    return await fs.readFile(localPath)
  } catch {
    if (!url) throw new Error(`No local file at ${localPath} and the media document has no URL`)
    const response = await fetch(new URL(url, getServerSideURL()))
    if (!response.ok) throw new Error(`Media fetch failed (${response.status})`)
    return Buffer.from(await response.arrayBuffer())
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) return

  const payload = await getPayload({ config })

  try {
    const media = await payload.find({
      collection: 'media',
      depth: 0,
      limit: 1000,
      pagination: false,
    })

    const pending = media.docs.filter(
      (doc) =>
        isCvFilename(doc.filename) &&
        (typeof doc.cvHtml !== 'string' || doc.cvHtml.trim() === ''),
    )

    if (pending.length === 0) {
      console.log('Every CV media document already has rendered HTML. Nothing to do.')
      return
    }

    for (const doc of pending) {
      console.log(`- ${doc.filename} (id ${doc.id})`)
    }

    if (!options.apply) {
      console.log('\nDry run: no documents changed. Re-run with --apply to render them.')
      return
    }

    for (const doc of pending) {
      const filename = doc.filename as string
      const buffer = await readMediaFile(filename, doc.url)
      const result = await convertCvFile({ buffer, filename })
      await payload.update({
        collection: 'media',
        id: doc.id,
        data: { cvHtml: result.html, cvRenderNote: result.note ?? null },
        context: { skipCvRender: true, disableRevalidate: true },
      })
      console.log(`Rendered ${filename} (${result.source}).`)
    }
  } finally {
    await payload.destroy()
  }
}

await main()
