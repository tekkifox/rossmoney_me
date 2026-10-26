#!/usr/bin/env node
/**
 * Token guard — rossmoney.me
 *
 * Fails when a raw colour literal appears outside src/styles/tokens.css in the
 * styled source under payload-cms/src (CSS, SCSS, TS and TSX).
 *
 * Plain Node, no dependencies. Run with `pnpm --dir payload-cms lint:tokens`.
 *
 * Named exceptions live below and are documented in DESIGN.md. They exist only
 * where a literal is part of a contract we cannot change without a product or
 * test decision.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const srcRoot = path.join(projectRoot, 'src')
const tokensFile = path.join(srcRoot, 'styles', 'tokens.css')

const SCANNED_EXTENSIONS = new Set(['.css', '.scss', '.ts', '.tsx'])

const COLOUR_PATTERNS = [
  { label: 'hex', regex: /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g },
  { label: 'rgb()/rgba()', regex: /\brgba?\s*\(/g },
  { label: 'hsl()/hsla()', regex: /\bhsla?\s*\(/g },
]

/**
 * The DOCX rules are asserted verbatim by
 * tests/int/cv-docx-styles.int.spec.ts, so their colour literals cannot move to
 * tokens.css without changing that integration contract first. Everything else
 * in this file is tokenised.
 */
const EXCEPTIONS = [
  {
    file: 'src/app/(frontend)/local-styles.css',
    match: /^\.docx \{ color: #555;/,
    reason: 'DOCX base text colour; asserted by the DOCX integration test.',
  },
  {
    file: 'src/app/(frontend)/local-styles.css',
    match: /^\.docx \.docx-font-size-13-5 \{ font-size: 13\.5pt; color: #111 \}/,
    reason: 'DOCX heading colour; font-size asserted verbatim by the DOCX integration test.',
  },
  {
    file: 'src/app/(frontend)/local-styles.css',
    match: /^\.docx \.docx-font-size-14 \{ font-size: 14pt; color: #2386f5 \}/,
    reason: 'DOCX accent colour; font-size asserted verbatim by the DOCX integration test.',
  },
  {
    file: 'src/app/(frontend)/local-styles.css',
    match: /^\.docx \.docx-font-size-22 \{ font-size: 22pt; color: #111 \}/,
    reason: 'DOCX title colour; font-size asserted verbatim by the DOCX integration test.',
  },
  {
    file: 'src/app/(frontend)/local-styles.css',
    match: /^\.docx \.docx-color-555555 \{ color: #555 \}/,
    reason: 'DOCX colour class; asserted verbatim by the DOCX integration test.',
  },
  {
    file: 'src/app/(frontend)/local-styles.css',
    match: /^\.docx \.docx-color-111111 \{ color: #111 \}/,
    reason: 'DOCX colour class; asserted verbatim by the DOCX integration test.',
  },
  {
    file: 'src/app/(frontend)/local-styles.css',
    match: /^\.docx \.docx-color-2386f5 \{ color: #2386f5 \}/,
    reason: 'DOCX colour class; asserted verbatim by the DOCX integration test.',
  },
  {
    file: 'src/app/(frontend)/local-styles.css',
    match: /^\.docx p\.docx-section-rule \{ border-bottom: 1\.5pt solid #111/,
    reason: 'DOCX section rule; border asserted verbatim by the DOCX integration test.',
  },
  {
    file: 'src/app/(frontend)/local-styles.css',
    match: /^\.docx p\.docx-entry-rule \{ border-bottom: 1px solid rgba\(17, 17, 17, 0\.2\)/,
    reason: 'DOCX entry rule; border asserted verbatim by the DOCX integration test.',
  },
]

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)))
      continue
    }
    if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

function toRelative(file) {
  return path.relative(projectRoot, file).split(path.sep).join('/')
}

function findColourLiterals(line) {
  const hits = []
  for (const { label, regex } of COLOUR_PATTERNS) {
    regex.lastIndex = 0
    let match
    while ((match = regex.exec(line)) !== null) {
      hits.push({ label, value: match[0] })
    }
  }
  return hits
}

function isExcepted(relativePath, line) {
  return EXCEPTIONS.find(
    (exception) => exception.file === relativePath && exception.match.test(line),
  )
}

async function main() {
  let files
  try {
    files = await collectFiles(srcRoot)
  } catch (error) {
    console.error(`token-guard: cannot read ${srcRoot}: ${error.message}`)
    process.exit(1)
  }

  const violations = []
  let exceptionCount = 0

  for (const file of files) {
    const relativePath = toRelative(file)
    if (path.resolve(file) === path.resolve(tokensFile)) continue

    const contents = await readFile(file, 'utf8')
    const lines = contents.split(/\r?\n/)

    lines.forEach((line, index) => {
      const hits = findColourLiterals(line)
      if (hits.length === 0) return

      const exception = isExcepted(relativePath, line)
      if (exception) {
        exceptionCount += 1
        return
      }

      violations.push({
        file: relativePath,
        line: index + 1,
        hits: [...new Set(hits.map((hit) => `${hit.label} ${hit.value}`))],
        text: line.trim(),
      })
    })
  }

  if (violations.length > 0) {
    console.error('token-guard: raw colour literals found outside src/styles/tokens.css\n')
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}  ${violation.hits.join(', ')}`)
      console.error(`    ${violation.text}`)
    }
    console.error(
      '\nAdd a semantic token to src/styles/tokens.css and use var(--token) instead.',
    )
    console.error('If the literal is a contract that cannot move, add a named exception to scripts/check-tokens.mjs and DESIGN.md.')
    process.exit(1)
  }

  const suffix = exceptionCount > 0 ? ` (${exceptionCount} documented DOCX exception${exceptionCount === 1 ? '' : 's'})` : ''
  console.log(`token-guard: no raw colour literals outside src/styles/tokens.css${suffix}.`)
}

await main()
